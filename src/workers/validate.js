import { CANONICAL_QUEUES, QUALIFICATION_PROFILES } from '../orchestration-profiles.js';
import {
  evaluateQualificationEvidence,
  qualifyCandidate
} from '../qualification-engine.js';
import {
  upsertRevenueRecord,
  claimRevenueRecords,
  updateRevenueRecord
} from '../revenue-store.js';
import { sharedReasoningEngine } from '../reasoning-engine.js';

export const EIGHT_MONEY_FLOW_GATES = Object.freeze([
  ...QUALIFICATION_PROFILES.programmable_money_flow_v1.evidenceGates
]);

export function evaluateEvidenceGates(candidate = {}) {
  return evaluateQualificationEvidence(candidate, candidate.profile || 'programmable_money_flow_v1');
}

function classificationAfterCustomEvidence(qualification, evidenceCheck, profileName) {
  if (!qualification.eligibleForValidation) return 'REJECTED';
  if (!evidenceCheck?.passed) return evidenceCheck?.status || 'NEEDS_EVIDENCE';
  if (qualification.setupState === 'BLOCKED') return 'BLOCKED';
  if (qualification.setupState === 'SETUP_REQUIRED') return 'SETUP_REQUIRED';
  return QUALIFICATION_PROFILES[profileName].passStatus;
}

/**
 * Validate is the sole promotion boundary between candidate_queue and
 * execution_queue. Numeric/model confidence never overrides profile evidence,
 * capability health, or setup state.
 */
export async function runValidateWorker({
  limit = 10,
  claimedBy = 'taskman-validate-worker',
  validatorFn = null,
  mockAiReasoning = null,
  capabilityOptions = {}
} = {}) {
  const startedAt = new Date().toISOString();
  const claimed = await claimRevenueRecords(CANONICAL_QUEUES.candidates, { limit, claimedBy });
  const validated = [];
  const promoted = [];
  const rejected = [];
  const needsEvidence = [];

  for (const item of claimed) {
    let candidate = item.payload.candidate || item.payload;
    const profileName = candidate.profile || 'programmable_money_flow_v1';

    if ((sharedReasoningEngine.isConfigured() || mockAiReasoning) &&
        (!candidate.gateEvidence || Object.keys(candidate.gateEvidence).length === 0)) {
      try {
        const aiValidation = await sharedReasoningEngine.validateAdversarial({
          candidate,
          freshEvidence: candidate.evidence || [],
          mockProvider: mockAiReasoning
        });
        if (aiValidation.ok && aiValidation.data?.gateEvidence) {
          candidate = { ...candidate, gateEvidence: aiValidation.data.gateEvidence };
        }
      } catch {
        // Non-authoritative AI failure leaves the candidate evidence-incomplete.
      }
    }

    const qualification = qualifyCandidate(candidate, profileName, { capabilityOptions });
    const evidenceCheck = typeof validatorFn === 'function'
      ? await validatorFn(candidate, qualification.capabilities)
      : qualification.evidence;
    const classification = typeof validatorFn === 'function'
      ? classificationAfterCustomEvidence(qualification, evidenceCheck, profileName)
      : qualification.recommendedStatus;
    const missingCapabilities = [
      ...qualification.capabilities.setupRequired,
      ...qualification.capabilities.unavailable,
      ...qualification.capabilities.unhealthy
    ];

    const validationPayload = {
      candidate,
      qualification,
      classification,
      evidenceCheck,
      missingCapabilities,
      validatedAt: startedAt,
      validatedBy: claimedBy
    };

    await updateRevenueRecord(item.id, {
      status: classification === 'REJECTED' ? 'REJECTED' : 'VALIDATED',
      payload: { ...item.payload, validation: validationPayload },
      releaseClaim: true
    });

    const valRecord = await upsertRevenueRecord({
      queue: CANONICAL_QUEUES.validation,
      noveltyKey: `val-${candidate.noveltyKey || item.id}`,
      status: classification,
      priority: item.priority,
      payload: validationPayload
    });
    validated.push(valRecord);

    if (['EXECUTABLE', 'SETUP_REQUIRED', 'THRESHOLD_CROSSED'].includes(classification)) {
      promoted.push(await upsertRevenueRecord({
        queue: CANONICAL_QUEUES.execution,
        noveltyKey: `exec-${candidate.noveltyKey || item.id}`,
        status: 'NEW',
        priority: item.priority,
        payload: {
          candidate,
          validation: validationPayload,
          classification,
          missingCapabilities,
          enqueuedAt: startedAt
        }
      }));
    } else if (classification === 'REJECTED' || classification === 'BLOCKED') {
      rejected.push(candidate);
    } else {
      needsEvidence.push(candidate);
    }
  }

  if (validated.length > 0) {
    await upsertRevenueRecord({
      queue: CANONICAL_QUEUES.inference,
      noveltyKey: `inference-validate-${startedAt.slice(0, 13)}`,
      status: 'NEW',
      priority: 5,
      payload: {
        stage: 'VALIDATE',
        claimedCount: claimed.length,
        promotedCount: promoted.length,
        rejectedCount: rejected.length,
        needsEvidenceCount: needsEvidence.length,
        timestamp: startedAt
      }
    });
  }

  return {
    stage: 'VALIDATE',
    status: 'COMPLETED',
    claimedCount: claimed.length,
    validatedCount: validated.length,
    promotedCount: promoted.length,
    rejectedCount: rejected.length,
    needsEvidenceCount: needsEvidence.length,
    promotedRecords: promoted,
    timestamp: startedAt
  };
}

if (process.argv[1]?.endsWith('validate.js')) {
  runValidateWorker().then(res => console.log(JSON.stringify(res, null, 2))).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
