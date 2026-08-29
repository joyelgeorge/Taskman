import {
  CANONICAL_QUEUES,
  capabilitySnapshot
} from '../orchestration-profiles.js';
import {
  claimRevenueRecords,
  updateRevenueRecord,
  upsertRevenueRecord,
  setRevenueState,
  getRevenueState
} from '../revenue-store.js';

/**
 * Taskman Execute Worker
 * 
 * Responsibilities:
 * 1. Claim from execution_queue.
 * 2. Check shared capability registry.
 * 3. Perform the next permitted executable step.
 * 4. Classify results (ADVANCED, COMPLETED, VALUE_CREATED, MONEY_EVENT, SETUP_REQUIRED, BLOCKED, REVALIDATE, REJECTED).
 * 5. Write results to economic_outcomes.
 * 6. Write execution/capability/economic lessons to learning_inference.
 * 
 * Invariants:
 * - NEVER simulate VALUE_CREATED or MONEY_EVENT.
 * - If no concrete authorized execution adapter/action is available, return BLOCKED, SETUP_REQUIRED, or REVALIDATE.
 * - Candidate estimatedValue is NEVER realized attributable value.
 * - Realized attributableValue must be 0 / null until verified by an actual execution outcome.
 */
export async function runExecuteWorker({
  limit = 10,
  claimedBy = 'taskman-execute-worker',
  executorFn = null
} = {}) {
  const startedAt = new Date().toISOString();
  const claimed = await claimRevenueRecords(CANONICAL_QUEUES.execution, { limit, claimedBy });
  const capabilities = capabilitySnapshot();

  const executed = [];
  const outcomes = [];

  for (const item of claimed) {
    const candidate = item.payload.candidate || item.payload;
    const missing = Array.isArray(item.payload.missingCapabilities) ? item.payload.missingCapabilities : [];

    let outcomeStatus = 'BLOCKED';
    let outcomeReason = 'No concrete authorized execution adapter available for candidate';
    let attributableValue = 0; // Invariant: candidate estimates are NOT realized value
    let stepOutput = null;

    // Check capabilities first
    if (missing.length > 0) {
      outcomeStatus = 'SETUP_REQUIRED';
      outcomeReason = `Missing required capabilities: ${missing.join(', ')}`;
    } else if (typeof executorFn === 'function') {
      try {
        stepOutput = await executorFn(candidate, capabilities);
        outcomeStatus = stepOutput.status || 'COMPLETED';
        outcomeReason = stepOutput.reason || 'Executed via authorized executor function';
        // Only set attributable value if verified and provided by real executor output
        attributableValue = Number(stepOutput.verifiedAttributableValue || stepOutput.attributableValue || 0);
      } catch (err) {
        outcomeStatus = 'BLOCKED';
        outcomeReason = `Execution error: ${err.message}`;
      }
    } else {
      // Invariant: In the absence of a concrete authorized executor adapter,
      // execution MUST NOT simulate success or money events.
      outcomeStatus = 'BLOCKED';
      outcomeReason = 'No authorized executable action adapter configured for this candidate type; safe default is BLOCKED';
      attributableValue = 0;
    }

    const outcomePayload = {
      candidateId: candidate.candidateId,
      noveltyKey: candidate.noveltyKey || item.noveltyKey,
      title: candidate.title,
      classification: item.payload.classification,
      outcomeStatus,
      outcomeReason,
      attributableValue,
      executedAt: startedAt,
      executedBy: claimedBy,
      stepOutput
    };

    // Update execution_queue record
    await updateRevenueRecord(item.id, {
      status: outcomeStatus,
      payload: { ...item.payload, outcome: outcomePayload },
      releaseClaim: true
    });

    // Write result to economic_outcomes
    const outcomeRecord = await upsertRevenueRecord({
      queue: CANONICAL_QUEUES.outcomes,
      noveltyKey: `outcome-${candidate.noveltyKey || item.id}`,
      status: outcomeStatus,
      priority: Math.round(attributableValue || 0),
      payload: outcomePayload
    });
    outcomes.push(outcomeRecord);
    executed.push(outcomePayload);
  }

  // Write lessons into learning_inference
  if (outcomes.length > 0) {
    await upsertRevenueRecord({
      queue: CANONICAL_QUEUES.inference,
      noveltyKey: `inference-execute-${startedAt.slice(0, 13)}`,
      status: 'NEW',
      priority: 8,
      payload: {
        stage: 'EXECUTE',
        claimedCount: claimed.length,
        outcomesCount: outcomes.length,
        moneyEventsCount: outcomes.filter(o => o.status === 'MONEY_EVENT').length,
        blockedCount: outcomes.filter(o => o.status === 'BLOCKED').length,
        setupRequiredCount: outcomes.filter(o => o.status === 'SETUP_REQUIRED').length,
        timestamp: startedAt
      }
    });
  }

  return {
    stage: 'EXECUTE',
    status: 'COMPLETED',
    claimedCount: claimed.length,
    outcomesCount: outcomes.length,
    outcomes,
    timestamp: startedAt
  };
}

if (process.argv[1]?.endsWith('execute.js')) {
  runExecuteWorker().then(res => console.log(JSON.stringify(res, null, 2))).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
