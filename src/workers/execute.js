import {
  CANONICAL_QUEUES
} from '../orchestration-profiles.js';
import {
  evaluateRequiredCapabilities,
  getRuntimeCapabilityMap
} from '../capability-registry.js';
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
import { sharedReasoningEngine } from '../reasoning-engine.js';
import {
  evaluatePastGuidance,
  GUIDANCE_EVALUATIONS,
  recordLearningInference
} from '../learning-inference.js';
import { addTraceEvent, recordStageResult, withTelemetrySpan } from '../observability.js';

async function runExecuteWorkerImpl({
  limit = 10,
  claimedBy = 'taskman-execute-worker',
  executorFn = null,
  mockAiReasoning = null,
  capabilityOptions = {},
  signal
} = {}) {
  signal?.throwIfAborted();
  const startedAt = new Date().toISOString();
  const claimed = await claimRevenueRecords(CANONICAL_QUEUES.execution, { limit, claimedBy });
  const capabilities = getRuntimeCapabilityMap(capabilityOptions);

  const executed = [];
  const outcomes = [];

  for (const item of claimed) {
    signal?.throwIfAborted();
    const candidate = item.payload.candidate || item.payload;
    const requiredCapabilities = Array.isArray(candidate.requiredCapabilities)
      ? candidate.requiredCapabilities
      : [];
    const capabilityDecision = evaluateRequiredCapabilities(requiredCapabilities, capabilityOptions);

    let aiPlan = null;
    if (sharedReasoningEngine.isConfigured() || mockAiReasoning) {
      try {
        const planResult = await sharedReasoningEngine.planExecution({
          candidate,
          availableCapabilities: capabilities,
          mockProvider: mockAiReasoning
        });
        if (planResult.ok) aiPlan = planResult.data;
      } catch {
        // Fall back gracefully
      }
    }

    let outcomeStatus = 'BLOCKED';
    let outcomeReason = 'No concrete authorized execution adapter available for candidate';
    let attributableValue = 0; // Invariant: candidate estimates are NOT realized value
    let stepOutput = null;

    // Check capabilities first
    if (capabilityDecision.unavailable.length > 0 || capabilityDecision.unhealthy.length > 0) {
      const blocked = [...capabilityDecision.unavailable, ...capabilityDecision.unhealthy];
      outcomeStatus = 'BLOCKED';
      outcomeReason = `Required capabilities unavailable: ${blocked.join(', ')}`;
    } else if (capabilityDecision.setupRequired.length > 0) {
      outcomeStatus = 'SETUP_REQUIRED';
      outcomeReason = `Required capabilities need setup: ${capabilityDecision.setupRequired.join(', ')}`;
    } else if (typeof executorFn === 'function') {
      try {
        stepOutput = await executorFn(candidate, capabilities, aiPlan, { signal });
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
    addTraceEvent('pipeline.terminal', {
      stage: 'EXECUTE', queue: 'outcomes', candidate_id: candidate.candidateId,
      queue_item_id: outcomeRecord.id, outcome: outcomeStatus
    });

    const priorLearningIds = item.payload.learning?.appliedLearningIds ||
      item.payload.validation?.learning?.appliedLearningIds || [];
    const guidanceEvaluation = ['COMPLETED', 'ADVANCED', 'VALUE_CREATED', 'MONEY_EVENT'].includes(outcomeStatus)
      ? GUIDANCE_EVALUATIONS.USEFUL
      : ['BLOCKED', 'REJECTED'].includes(outcomeStatus)
        ? GUIDANCE_EVALUATIONS.MISLEADING
        : GUIDANCE_EVALUATIONS.INCONCLUSIVE;
    for (const learningId of priorLearningIds) {
      signal?.throwIfAborted();
      await evaluatePastGuidance(learningId, guidanceEvaluation, {
        evidenceRef: `outcome:${outcomeRecord.id}`,
        now: new Date(startedAt)
      });
    }
    await recordLearningInference({
      statement: `${candidate.sourceType || 'unknown'} execution ended ${outcomeStatus}: ${outcomeReason}`,
      classification: 'TEMPORARY_HINT',
      confidence: 0.65,
      supportingEvidence: [`outcome:${outcomeRecord.id}`],
      sourceWorker: claimedBy,
      scope: `candidate:${candidate.candidateId || candidate.noveltyKey || item.id}`,
      mandatoryChecks: [...capabilityDecision.unavailable, ...capabilityDecision.unhealthy, ...capabilityDecision.setupRequired],
      weightAdjustment: {
        targetType: 'source',
        target: candidate.sourceType || 'unknown',
        delta: guidanceEvaluation === GUIDANCE_EVALUATIONS.USEFUL ? 0.05 : -0.1
      },
      createdAt: startedAt
    }, { now: new Date(startedAt) });
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

export async function runExecuteWorker(options = {}) {
  const started = Date.now();
  return withTelemetrySpan('pipeline.execute', {
    correlation_id: options.correlationId,
    run_key: options.runKey,
    schedule_id: options.scheduleId,
    stage: 'EXECUTE'
  }, async () => {
    const result = await runExecuteWorkerImpl(options);
    result.durationMs = Date.now() - started;
    recordStageResult('EXECUTE', result);
    return result;
  });
}

if (process.argv[1]?.endsWith('execute.js')) {
  runExecuteWorker().then(res => console.log(JSON.stringify(res, null, 2))).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
