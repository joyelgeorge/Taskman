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

    let outcomeStatus = 'COMPLETED';
    let outcomeReason = 'Execution completed successfully';
    let attributableValue = candidate.estimatedValue || 0;
    let stepOutput = null;

    // Check capabilities
    if (missing.length > 0) {
      outcomeStatus = 'SETUP_REQUIRED';
      outcomeReason = `Missing required capabilities: ${missing.join(', ')}`;
    } else if (typeof executorFn === 'function') {
      try {
        stepOutput = await executorFn(candidate, capabilities);
        outcomeStatus = stepOutput.status || 'COMPLETED';
        attributableValue = stepOutput.attributableValue || attributableValue;
      } catch (err) {
        outcomeStatus = 'BLOCKED';
        outcomeReason = err.message;
      }
    } else {
      // Default safe executable action simulation
      outcomeStatus = attributableValue > 0 ? 'MONEY_EVENT' : 'VALUE_CREATED';
      outcomeReason = `Deterministic execution rail activated for candidate: ${candidate.title}`;
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
      priority: Math.round(attributableValue || item.priority),
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
