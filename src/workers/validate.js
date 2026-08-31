import {
  CANONICAL_QUEUES
} from '../orchestration-profiles.js';
import { getRuntimeCapabilityMap } from '../capability-registry.js';
import {
  qualifyCandidate,
  missingCapabilities
} from '../qualification-engine.js';
import {
  upsertRevenueRecord,
  claimRevenueRecords,
  updateRevenueRecord,
  setRevenueState,
  getRevenueState
} from '../revenue-store.js';

export const EIGHT_MONEY_FLOW_GATES = Object.freeze([
  'money_flow_scale',
  'recurring_leakage',
  'independent_trigger',
  'permission_non_invasive',
  'measurable_delta',
  'monetization',
  'no_transaction_ownership',
  'competitive_whitespace'
]);

/**
 * Gate-result descriptor expected in candidate.gateEvidence:
 *   { [gateName]: { verdict: 'pass' | 'fail' | 'uncertain', evidenceRef: string } }
 *
 * Backwards-compat: candidate.gates provides legacy flat verdict strings.
 * If a gate has verdict='pass' in legacy gates[] but NO entry in gateEvidence with a
 * non-empty evidenceRef, it is treated as 'missing' (unverified assertion).
 */
export function evaluateEvidenceGates(candidate = {}) {
  const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
  const profile = candidate.profile || 'programmable_money_flow_v1';
  // Per-gate structured evidence: { [gate]: { verdict, evidenceRef } }
  const gateEvidence = candidate.gateEvidence || {};
  // Legacy flat verdicts — used as fallback only when gateEvidence is absent for a gate
  const legacyGates = candidate.gates || candidate.raw?.gates || {};

  // If candidate has zero top-level evidence, it cannot be promoted regardless of gate assertions
  if (evidence.length === 0) {
    return {
      passed: false,
      status: 'NEEDS_EVIDENCE',
      reason: 'No verifiable evidence attached to candidate',
      gateResults: {}
    };
  }

  if (profile === 'programmable_money_flow_v1') {
    const gateResults = {};
    const failedGates = [];
    const uncertainGates = [];

    for (const gate of EIGHT_MONEY_FLOW_GATES) {
      // Per-gate binding takes priority
      const perGate = gateEvidence[gate];
      let verdict;
      let evidenceRef;

      if (perGate) {
        verdict = String(perGate.verdict || '').toLowerCase();
        evidenceRef = perGate.evidenceRef ? String(perGate.evidenceRef).trim() : '';
      } else {
        // Legacy flat string — accepted only if *some* global evidence exists AND verdict is 'pass'
        verdict = String(legacyGates[gate] || '').toLowerCase();
        evidenceRef = ''; // No specific citation — treated as missing for THRESHOLD_CROSSED
      }

      if (verdict === 'fail') {
        gateResults[gate] = { verdict: 'fail', evidenceRef };
        failedGates.push(gate);
      } else if (verdict === 'pass' && evidenceRef) {
        // Verified: pass with specific evidence reference
        gateResults[gate] = { verdict: 'pass', evidenceRef };
      } else {
        // Unverified: pass without specific evidence, uncertain, or missing
        const displayVerdict = (verdict === 'pass') ? 'pass_unverified' : (verdict || 'missing');
        gateResults[gate] = { verdict: displayVerdict, evidenceRef: evidenceRef || null };
        uncertainGates.push(gate);
      }
    }

    if (failedGates.length > 0) {
      return {
        passed: false,
        status: 'REJECTED',
        reason: `Adversarial validation failed on gates: ${failedGates.join(', ')}`,
        gateResults
      };
    }

    if (uncertainGates.length > 0) {
      return {
        passed: false,
        status: 'NEEDS_EVIDENCE',
        reason: `Missing per-gate evidence citations on: ${uncertainGates.join(', ')}. Each gate pass must supply gateEvidence[gate].evidenceRef.`,
        gateResults
      };
    }

    return {
      passed: true,
      status: 'THRESHOLD_CROSSED',
      reason: 'All 8 money-flow gates verified with individual evidence citations',
      gateResults
    };
  }

  if (profile === 'bounty_execution_v1' || profile === 'immediate_income_v1') {
    const hasPayerEvidence = evidence.some(e => typeof e === 'string' && (e.includes('escrow') || e.includes('payer') || e.includes('bounty') || e.includes('http')));
    const hasAcceptanceCriteria = Boolean(candidate.acceptanceCriteria || candidate.raw?.acceptance_criteria || candidate.raw?.description);
    const hasReward = Number(candidate.estimatedValue ?? candidate.raw?.reward ?? candidate.raw?.budget ?? 0) > 0;

    if (!hasPayerEvidence || !hasAcceptanceCriteria || !hasReward) {
      return {
        passed: false,
        status: 'NEEDS_EVIDENCE',
        reason: 'Missing evidence of verified payer, clear acceptance criteria, or reward amount',
        gateResults: { hasPayerEvidence, hasAcceptanceCriteria, hasReward }
      };
    }

    return {
      passed: true,
      status: 'EXECUTABLE',
      reason: 'Bounty/income criteria verified with evidence',
      gateResults: { hasPayerEvidence, hasAcceptanceCriteria, hasReward }
    };
  }

  return {
    passed: false,
    status: 'NEEDS_EVIDENCE',
    reason: `Unknown profile ${profile} requires evidence validation`,
    gateResults: {}
  };
}

/**
 * Taskman Validate Worker
 * 
 * Responsibilities:
 * 1. Claim from candidate_queue.
 * 2. Reuse existing evidence first; obtain only missing/stale evidence.
 * 3. Run the adversarial validation profile appropriate to the candidate.
 * 4. Write records to validation_queue.
 * 5. Enqueue EXECUTABLE, SETUP_REQUIRED, or THRESHOLD_CROSSED items into execution_queue.
 * 6. Write reusable findings to learning_inference.
 * 7. Release/requeue items that need more evidence.
 * 
 * Invariants:
 * - Numeric qualification score alone MUST NEVER produce EXECUTABLE or THRESHOLD_CROSSED.
 * - Missing evidence must produce NEEDS_EVIDENCE.
 * - Programmable-money-flow THRESHOLD_CROSSED requires explicit evidence-backed PASS on all 8 gates.
 */
import { sharedReasoningEngine } from '../reasoning-engine.js';

export async function runValidateWorker({
  limit = 10,
  claimedBy = 'taskman-validate-worker',
  validatorFn = null,
  mockAiReasoning = null,
  capabilityOptions = {}
} = {}) {
  const startedAt = new Date().toISOString();
  const claimed = await claimRevenueRecords(CANONICAL_QUEUES.candidates, { limit, claimedBy });
  const capabilities = getRuntimeCapabilityMap(capabilityOptions);

  const validated = [];
  const promoted = [];
  const rejected = [];
  const needsEvidence = [];

  for (const item of claimed) {
    let candidate = item.payload.candidate || item.payload;
    const profileName = candidate.profile || 'programmable_money_flow_v1';

    // If AI reasoning is available and candidate is missing gate evidence, run adversarial validation
    if ((sharedReasoningEngine.isConfigured() || mockAiReasoning) && (!candidate.gateEvidence || Object.keys(candidate.gateEvidence).length === 0)) {
      try {
        const aiValidation = await sharedReasoningEngine.validateAdversarial({
          candidate,
          freshEvidence: candidate.evidence || [],
          mockProvider: mockAiReasoning
        });
        if (aiValidation.ok && aiValidation.data?.gateEvidence) {
          candidate = {
            ...candidate,
            gateEvidence: aiValidation.data.gateEvidence
          };
        }
      } catch {
        // Fall back gracefully to existing evidence
      }
    }
    
    // 1. Initial qualification check
    const qual = qualifyCandidate(candidate, profileName);
    const missing = missingCapabilities(candidate, capabilities);

    // 2. Perform adversarial evidence-driven gate validation
    let evidenceCheck;
    if (typeof validatorFn === 'function') {
      evidenceCheck = await validatorFn(candidate, capabilities);
    } else {
      evidenceCheck = evaluateEvidenceGates(candidate);
    }

    let classification = evidenceCheck.status || 'NEEDS_EVIDENCE';

    // If gates pass but capabilities are missing, classify as SETUP_REQUIRED
    if (evidenceCheck.passed && missing.length > 0) {
      classification = 'SETUP_REQUIRED';
    }

    const validationPayload = {
      candidate,
      qualification: qual,
      classification,
      evidenceCheck,
      missingCapabilities: missing,
      validatedAt: startedAt,
      validatedBy: claimedBy
    };

    // Update the candidate record status
    await updateRevenueRecord(item.id, {
      status: classification === 'REJECTED' ? 'REJECTED' : 'VALIDATED',
      payload: { ...item.payload, validation: validationPayload },
      releaseClaim: true
    });

    // Write record to validation_queue
    const valRecord = await upsertRevenueRecord({
      queue: CANONICAL_QUEUES.validation,
      noveltyKey: `val-${candidate.noveltyKey || item.id}`,
      status: classification,
      priority: item.priority,
      payload: validationPayload
    });
    validated.push(valRecord);

    // Enqueue EXECUTABLE, SETUP_REQUIRED, or THRESHOLD_CROSSED items into execution_queue
    if (['EXECUTABLE', 'SETUP_REQUIRED', 'THRESHOLD_CROSSED'].includes(classification)) {
      const execRecord = await upsertRevenueRecord({
        queue: CANONICAL_QUEUES.execution,
        noveltyKey: `exec-${candidate.noveltyKey || item.id}`,
        status: 'NEW',
        priority: item.priority,
        payload: {
          candidate,
          validation: validationPayload,
          classification,
          missingCapabilities: missing,
          enqueuedAt: startedAt
        }
      });
      promoted.push(execRecord);
    } else if (classification === 'REJECTED') {
      rejected.push(candidate);
    } else {
      needsEvidence.push(candidate);
    }
  }

  // Write reusable findings into learning_inference
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
