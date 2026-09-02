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
 * - Realized attributableValue comes only from a settlement accepted by money-ledger,
 *   which requires an external reference a payment processor can be re-queried for.
 *   An executor's own claim about what it earned is discarded.
 * - A rail whose probation budget or attempt allowance is spent without a verified
 *   settlement is switched off rather than retried.
 */
import { sharedReasoningEngine } from '../reasoning-engine.js';
import { runExecutionPlan } from '../transforms/execution-plan.js';
import {
  recordAttempt,
  finishAttempt,
  recordSettlement,
  enforceRailViability,
  isRailEnabled,
  getRailState,
  SETTLEMENT_STATUS
} from '../money-ledger.js';
import { globalBudgetStatus, enforceRailGovernor } from '../rail-governor.js';

export async function runExecuteWorker({
  limit = 10,
  claimedBy = 'taskman-execute-worker',
  executorFn = null,
  mockAiReasoning = null,
  rail = 'default',
  attemptCostCents = 0
} = {}) {
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
  const capabilities = capabilitySnapshot();

  const executed = [];
  const outcomes = [];

  for (const item of claimed) {
    const candidate = item.payload.candidate || item.payload;
    const missing = Array.isArray(item.payload.missingCapabilities) ? item.payload.missingCapabilities : [];

    // Every pass through this loop costs something, so every pass is recorded.
    // Attempts are the denominator the kill-switch divides settlements by.
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
    if (missing.length > 0) {
      outcomeStatus = 'SETUP_REQUIRED';
      outcomeReason = `Missing required capabilities: ${missing.join(', ')}`;
    } else if (typeof executorFn === 'function') {
      try {
        stepOutput = await executorFn(candidate, capabilities, aiPlan);
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

    await finishAttempt(attempt.id, {
      status: outcomeStatus,
      evidence: { outcomeReason, attributableValue }
    });

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

  // enforceRailViability is the legacy two-verdict check, kept for callers that
  // only need CONTINUE/DISABLE. enforceRailGovernor is the phase-4 state machine
  // (docs/TARGET_DESIGN.md §8) and is the one that actually writes rail_state.state.
  const viability = await enforceRailViability({ rail });
  const governor = await enforceRailGovernor({ rail });

  return {
    stage: 'EXECUTE',
    status: 'COMPLETED',
    rail,
    claimedCount: claimed.length,
    outcomesCount: outcomes.length,
    outcomes,
    viability,
    governor,
    timestamp: startedAt
  };
}

if (process.argv[1]?.endsWith('execute.js')) {
  runExecuteWorker().then(res => console.log(JSON.stringify(res, null, 2))).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
