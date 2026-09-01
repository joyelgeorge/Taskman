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
import {
  evaluatePastGuidance,
  GUIDANCE_EVALUATIONS,
  recordLearningInference
} from '../learning-inference.js';
import { addTraceEvent, recordStageResult, withTelemetrySpan } from '../observability.js';

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
async function runValidateWorkerImpl({
  limit = 10,
  claimedBy = 'taskman-validate-worker',
  validatorFn = null,
  mockAiReasoning = null,
  capabilityOptions = {},
  signal
} = {}) {
  signal?.throwIfAborted();
  const startedAt = new Date().toISOString();
  const claimed = await claimRevenueRecords(CANONICAL_QUEUES.candidates, { limit, claimedBy });
  const validated = [];
  const promoted = [];
  const rejected = [];
  const needsEvidence = [];

  for (const item of claimed) {
    signal?.throwIfAborted();
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
      learning: item.payload.learning || null,
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
    addTraceEvent('queue.transition', {
      stage: 'VALIDATE', queue: 'validation', candidate_id: candidate.candidateId,
      queue_item_id: valRecord.id, outcome: classification
    });

    const priorLearningIds = item.payload.learning?.appliedLearningIds || [];
    const guidanceEvaluation = ['REJECTED', 'BLOCKED'].includes(classification)
      ? GUIDANCE_EVALUATIONS.MISLEADING
      : classification === 'NEEDS_EVIDENCE'
        ? GUIDANCE_EVALUATIONS.INCONCLUSIVE
        : GUIDANCE_EVALUATIONS.USEFUL;
    for (const learningId of priorLearningIds) {
      signal?.throwIfAborted();
      await evaluatePastGuidance(learningId, guidanceEvaluation, {
        evidenceRef: `validation:${valRecord.id}`,
        now: new Date(startedAt)
      });
    }

    await recordLearningInference({
      statement: `${candidate.sourceType || 'unknown'} validation classified candidate as ${classification}`,
      classification: 'TEMPORARY_HINT',
      confidence: classification === 'NEEDS_EVIDENCE' ? 0.45 : 0.6,
      supportingEvidence: [`validation:${valRecord.id}`],
      sourceWorker: claimedBy,
      scope: `source:${candidate.sourceType || 'unknown'}`,
      mandatoryChecks: qualification.evidence?.missingGates || [],
      weightAdjustment: {
        targetType: 'source',
        target: candidate.sourceType || 'unknown',
        delta: ['REJECTED', 'BLOCKED'].includes(classification) ? -0.1 : 0.05
      },
      createdAt: startedAt
    }, { now: new Date(startedAt) });

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
          learning: item.payload.learning || null,
          enqueuedAt: startedAt
        }
      }));
    } else if (classification === 'REJECTED' || classification === 'BLOCKED') {
      rejected.push(candidate);
    } else {
      needsEvidence.push(candidate);
    }
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

export async function runValidateWorker(options = {}) {
  const started = Date.now();
  return withTelemetrySpan('pipeline.validate', {
    correlation_id: options.correlationId,
    run_key: options.runKey,
    schedule_id: options.scheduleId,
    stage: 'VALIDATE'
  }, async () => {
    const result = await runValidateWorkerImpl(options);
    result.durationMs = Date.now() - started;
    recordStageResult('VALIDATE', result);
    return result;
  });
}

if (process.argv[1]?.endsWith('validate.js')) {
  runValidateWorker().then(res => console.log(JSON.stringify(res, null, 2))).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
