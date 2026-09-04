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
 * - Realized attributableValue comes only from a settlement accepted by money-ledger,
 *   which requires an external reference a payment processor can be re-queried for.
 *   An executor's own claim about what it earned is discarded.
 * - A rail whose probation budget or attempt allowance is spent without a verified
 *   settlement is switched off rather than retried — see src/rail-governor.js.
 */
import { sharedReasoningEngine } from '../reasoning-engine.js';
import { runExecutionPlan } from '../transforms/execution-plan.js';
import {
  recordAttempt,
  finishAttempt,
  recordSettlement,
  evaluateRailViability,
  isRailEnabled,
  getRailState,
  SETTLEMENT_STATUS
} from '../money-ledger.js';
import { globalBudgetStatus, enforceRailGovernor } from '../rail-governor.js';
import {
  evaluatePastGuidance,
  GUIDANCE_EVALUATIONS,
  recordLearningInference
} from '../learning-inference.js';
import { addTraceEvent, recordStageResult, withTelemetrySpan } from '../observability.js';
import { logRestrictedError, stableErrorCode } from '../errors.js';
import { claimActionableWorkItem, releaseActionableWorkItem, WORK_ELIGIBILITY } from '../github-intake.js';
import { dispatchCodingAgentWork } from '../adapters/coding-agent-adapter.js';

async function runExecuteWorkerImpl({
  limit = 10,
  claimedBy = 'taskman-execute-worker',
  executorFn = null,
  mockAiReasoning = null,
  capabilityOptions = {},
  rail = 'default',
  attemptCostCents = 0,
  repo = process.env.TASKMAN_REPO || 'joyelgeorge/Taskman',
  codingAgentBackend = null,
  executeRepoWork = false,
  signal
} = {}) {
  signal?.throwIfAborted();
  const startedAt = new Date().toISOString();

  // A rail that burned its probation budget without a verified settlement stays off.
  // Claiming work for it would spend real money to re-learn what the ledger knows.
  if (!(await isRailEnabled(rail))) {
    const state = await getRailState(rail);
    return {
      stage: 'EXECUTE',
      status: 'RAIL_DISABLED',
      rail,
      reason: state?.disabled_reason || `rail ${rail} is disabled`,
      claimedCount: 0,
      outcomesCount: 0,
      outcomes: [],
      timestamp: startedAt
    };
  }

  // The global monthly cap bounds every rail combined, including a SCALED rail
  // whose own probation budget no longer applies — see docs/TARGET_DESIGN.md §8.
  const budget = await globalBudgetStatus();
  if (budget.exceeded) {
    return {
      stage: 'EXECUTE',
      status: 'GLOBAL_BUDGET_EXCEEDED',
      rail,
      reason: `global monthly spend $${(budget.spentCents / 100).toFixed(2)} has reached the $${(budget.capCents / 100).toFixed(2)} cap`,
      globalBudget: budget,
      claimedCount: 0,
      outcomesCount: 0,
      outcomes: [],
      timestamp: startedAt
    };
  }

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

    // Every pass through this loop costs something, so every pass is recorded.
    // Attempts are the denominator the governor divides settlements by.
    const attempt = await recordAttempt({
      rail,
      candidateKey: candidate.noveltyKey || item.noveltyKey || item.id,
      stage: 'EXECUTE',
      costCents: attemptCostCents,
      evidence: { title: candidate.title || null, claimedBy }
    });

    // Routed through the execution-plan transform, whose post-condition rejects
    // any plan that references a capability the registry does not actually grant
    // — schema validation alone cannot catch a plausible-sounding fabrication
    // like that. See docs/TARGET_DESIGN.md §11.
    let aiPlan = null;
    if (sharedReasoningEngine.isConfigured() || mockAiReasoning) {
      try {
        const planResult = await runExecutionPlan({
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

        // Realized value comes from a settlement the ledger accepted, never from the
        // executor's own claim about what it earned. An executor that reports revenue
        // without an external reference gets zero, by design.
        if (stepOutput.settlement) {
          const settlement = await recordSettlement({
            ...stepOutput.settlement,
            rail,
            attemptId: attempt.id
          });
          if (settlement.status === SETTLEMENT_STATUS.CLEARED) {
            attributableValue = settlement.netCents / 100;
            outcomeStatus = 'MONEY_EVENT';
            outcomeReason = `Verified settlement ${settlement.source}:${settlement.externalRef} cleared for ${settlement.netCents} cents`;
          } else {
            outcomeStatus = 'VALUE_CREATED';
            outcomeReason = `Settlement ${settlement.source}:${settlement.externalRef} recorded, awaiting clearance`;
          }
        }
      } catch (err) {
        outcomeStatus = 'BLOCKED';
        outcomeReason = `Execution error: ${stableErrorCode(err)}`;
      }
    } else {
      // Invariant: In the absence of a concrete authorized executor adapter,
      // execution MUST NOT simulate success or money events.
      outcomeStatus = 'BLOCKED';
      outcomeReason = 'No authorized executable action adapter configured for this candidate type; safe default is BLOCKED';
      attributableValue = 0;
    }

    await finishAttempt(attempt.id, {
      status: outcomeStatus,
      evidence: { outcomeReason, attributableValue }
    });

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

  // 6. Optional or scheduled execution of eligible GitHub repo work (#122)
  let repoExecution = null;
  if (executeRepoWork || process.env.TASKMAN_EXECUTE_REPO_WORK === 'true') {
    const claimedWork = await claimActionableWorkItem({ repo, claimedBy });
    if (claimedWork) {
      if (!codingAgentBackend) {
        // Missing backend credentials/capability produces SETUP_REQUIRED, not fake completion
        await releaseActionableWorkItem({
          repo,
          issueNumber: claimedWork.issueNumber,
          claimedBy,
          eligibilityStatus: WORK_ELIGIBILITY.READY,
          eligibilityReason: 'Coding agent backend not configured (SETUP_REQUIRED)'
        });
        repoExecution = {
          issueNumber: claimedWork.issueNumber,
          status: 'SETUP_REQUIRED',
          reason: 'No coding agent backend configured'
        };
      } else {
        const dispatchResult = await dispatchCodingAgentWork({
          workPackage: {
            repo: claimedWork.repo,
            issueNumber: claimedWork.issueNumber,
            title: claimedWork.title,
            body: claimedWork.rawPayload?.body || ''
          },
          backend: codingAgentBackend
        });

        if (dispatchResult.ok) {
          // Success: Suppress duplicate dispatch by marking IN_FLIGHT_PR with active PR details
          await releaseActionableWorkItem({
            repo,
            issueNumber: claimedWork.issueNumber,
            claimedBy,
            eligibilityStatus: WORK_ELIGIBILITY.IN_FLIGHT_PR,
            eligibilityReason: `Active PR #${dispatchResult.prNumber} opened`,
            activePr: {
              number: dispatchResult.prNumber,
              url: dispatchResult.prUrl,
              headRef: dispatchResult.branch,
              headSha: dispatchResult.headSha
            }
          });
        } else if (dispatchResult.status === 'FAILED_TESTS') {
          // Tests failed: release back to queue as NEEDS_PR_FIX or READY for retry
          await releaseActionableWorkItem({
            repo,
            issueNumber: claimedWork.issueNumber,
            claimedBy,
            eligibilityStatus: WORK_ELIGIBILITY.READY,
            eligibilityReason: `Implementation tests failed: ${dispatchResult.reason}`
          });
        } else {
          await releaseActionableWorkItem({
            repo,
            issueNumber: claimedWork.issueNumber,
            claimedBy,
            eligibilityStatus: WORK_ELIGIBILITY.READY,
            eligibilityReason: `Dispatch failed: ${dispatchResult.reason}`
          });
        }
        repoExecution = dispatchResult;
      }
    }
  }

  // evaluateRailViability is the legacy two-verdict check, kept for callers that
  // only need CONTINUE/DISABLE. enforceRailGovernor is the phase-4 state machine
  // (docs/TARGET_DESIGN.md §8) and is the one that actually writes rail_state.state.
  const viability = await evaluateRailViability({ rail });
  const governor = await enforceRailGovernor({ rail });

  return {
    stage: 'EXECUTE',
    status: 'COMPLETED',
    rail,
    claimedCount: claimed.length,
    outcomesCount: outcomes.length,
    outcomes,
    repoExecution,
    viability,
    governor,
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
    logRestrictedError(err, { context: 'worker:execute:cli' });
    process.exit(1);
  });
}
