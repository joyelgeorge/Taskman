import {
  CANONICAL_QUEUES,
  capabilitySnapshot
} from '../orchestration-profiles.js';
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

/**
 * Taskman Validate Worker
 * 
 * Responsibilities:
 * 1. Claim from candidate_queue.
 * 2. Reuse existing evidence first; obtain only missing/stale evidence.
 * 3. Run the validation profile appropriate to the candidate.
 * 4. Write records to validation_queue.
 * 5. Enqueue EXECUTABLE, SETUP_REQUIRED, or THRESHOLD_CROSSED items into execution_queue.
 * 6. Write reusable findings to learning_inference.
 * 7. Release/requeue items that need more evidence.
 */
export async function runValidateWorker({
  limit = 10,
  claimedBy = 'taskman-validate-worker'
} = {}) {
  const startedAt = new Date().toISOString();
  const claimed = await claimRevenueRecords(CANONICAL_QUEUES.candidates, { limit, claimedBy });
  const capabilities = capabilitySnapshot();

  const validated = [];
  const promoted = [];
  const rejected = [];
  const needsEvidence = [];

  for (const item of claimed) {
    const candidate = item.payload.candidate || item.payload;
    const profileName = candidate.profile || 'programmable_money_flow_v1';
    
    // Evaluate candidate qualification & capabilities
    const qual = qualifyCandidate(candidate, profileName);
    const missing = missingCapabilities(candidate, capabilities);

    // Adversarial validation checks:
    // 1. Evidence check: does candidate have any evidence or metrics?
    const hasEvidence = Array.isArray(candidate.evidence) && candidate.evidence.length > 0;
    const isPassing = qual.passes;

    let classification = 'REJECTED';
    if (!isPassing) {
      classification = 'REJECTED';
    } else if (missing.length > 0) {
      classification = 'SETUP_REQUIRED';
    } else if (qual.score >= 8.5) {
      classification = 'THRESHOLD_CROSSED';
    } else if (qual.score >= qual.threshold) {
      classification = 'EXECUTABLE';
    } else if (!hasEvidence) {
      classification = 'NEEDS_EVIDENCE';
    } else {
      classification = 'PROMISING';
    }

    const validationPayload = {
      candidate,
      qualification: qual,
      classification,
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
    } else if (classification === 'NEEDS_EVIDENCE') {
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
