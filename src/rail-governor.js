import { databaseEnabled, query, truncateForTesting } from './db.js';
import {
  railEconomics, railWindow, railProbationWindow, getRailState, setRailState, settlementLagFor
} from './money-ledger.js';

/**
 * The four-state rail governor (docs/TARGET_DESIGN.md §8).
 *
 * money-ledger.js stores what happened: attempts, settlements, the current state.
 * This module decides what happens next, computed from that ledger and never
 * argued — the whole point of a governor is that no one has to have an opinion
 * about whether a rail deserves another chance. It either settled money or it did
 * not, on a clock a human does not get to pause.
 *
 * PROBATION → PROVEN  first cleared settlement since this probation window began
 * PROBATION → DISABLED  probation budget or attempt allowance spent, zero settled
 * PROVEN    → SCALED    ≥10 lifetime cleared settlements at lifetime ROI ≥ 3.0
 * PROVEN    → PROBATION trailing-30-day ROI fell below 1.0
 * SCALED    → PROVEN    lifetime ROI fell below 2.0
 * DISABLED  → (nothing) leaves only by a human calling setRailEnabled(rail, true)
 */

const usd = c => `$${(Number(c || 0) / 100).toFixed(2)}`;
const daysAgoIso = (days, now) => new Date(now.getTime() - days * 86_400_000).toISOString();

const memoryBudget = { monthlyCapCents: Number(process.env.GLOBAL_MONTHLY_BUDGET_CENTS || 50_000) };

function monthStartIso(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Total attempt spend across every rail so far this calendar month, against the
 * cap — so a fleet of rails each individually inside their own probation budget
 * cannot collectively drain the account.
 */
export async function globalBudgetStatus({ now = new Date() } = {}) {
  const since = monthStartIso(now);

  if (!databaseEnabled) {
    const rails = await railEconomics();
    let spentCents = 0;
    for (const rail of rails) spentCents += (await railWindow(rail.rail, since)).spendCents;
    const capCents = memoryBudget.monthlyCapCents;
    return { capCents, spentCents, remainingCents: Math.max(0, capCents - spentCents), exceeded: spentCents >= capCents, since };
  }

  const [spendResult, capResult] = await Promise.all([
    query(`SELECT COALESCE(SUM(cost_cents),0)::bigint AS spend_cents FROM rail_attempts WHERE started_at >= $1`, [since]),
    query(`SELECT monthly_cap_cents FROM global_budget WHERE id = 'default'`)
  ]);
  const spentCents = Number(spendResult.rows[0].spend_cents);
  const capCents = Number(capResult.rows[0]?.monthly_cap_cents ?? memoryBudget.monthlyCapCents);
  return { capCents, spentCents, remainingCents: Math.max(0, capCents - spentCents), exceeded: spentCents >= capCents, since };
}

export async function setGlobalMonthlyBudget(capCents) {
  const cap = Math.max(0, Math.round(Number(capCents) || 0));
  if (!databaseEnabled) { memoryBudget.monthlyCapCents = cap; return { id: 'default', monthly_cap_cents: cap }; }
  const result = await query(`
    INSERT INTO global_budget(id, monthly_cap_cents) VALUES('default', $1)
    ON CONFLICT (id) DO UPDATE SET monthly_cap_cents = EXCLUDED.monthly_cap_cents, updated_at = now()
    RETURNING *
  `, [cap]);
  return result.rows[0];
}

/**
 * Computes the next state for a rail without writing anything. `enforceRailGovernor`
 * is the version that acts on the result; this one exists so a caller can preview
 * the decision (the dashboard, a dry run) without side effects.
 */
export async function evaluateRailGovernor({
  rail,
  probationBudgetCents,
  minAttempts = 25,
  scaleRoiThreshold = 3,
  scaleMinSettlements = 10,
  demoteRoiThreshold = 1,
  descaleRoiThreshold = 2,
  trailingDays = 30,
  now = new Date()
} = {}) {
  if (!rail) throw new Error('rail is required');

  const stateRow = await getRailState(rail);
  const currentState = stateRow?.state || 'PROBATION';
  const budgetOverride = Number(stateRow?.probation_budget_cents);
  const budget = Number.isFinite(probationBudgetCents) ? probationBudgetCents
    : Number.isFinite(budgetOverride) && budgetOverride > 0 ? budgetOverride
    : 5000;

  const [lifetime] = await railEconomics(rail);
  const economics = lifetime || {
    rail, attempts: 0, spendCents: 0, clearedCount: 0, clearedCents: 0, pendingCents: 0, netCents: 0,
    settlementRate: 0, valuePerAttemptCents: 0, roi: null
  };
  const trailing = await railWindow(rail, daysAgoIso(trailingDays, now));
  const base = { rail, state: currentState, economics, trailing };

  if (currentState === 'DISABLED') {
    return { ...base, nextState: 'DISABLED', reason: 'disabled rails leave only by a manual re-enable', budgetCents: 0 };
  }

  if (currentState === 'PROBATION') {
    // Epoch-scoped, not timestamp-scoped — see railProbationWindow's doc comment.
    const windowed = await railProbationWindow(rail, { settlementLagDays: settlementLagFor(rail) });

    if (windowed.clearedCents > 0) {
      return {
        ...base, nextState: 'PROVEN',
        reason: `first cleared settlement since probation began (${usd(windowed.clearedCents)})`,
        budgetCents: budget
      };
    }
    if (windowed.spendCents >= budget) {
      // Spend is real the moment it happens, so an exhausted budget still stops
      // the rail — but if attempts are merely young, say so, because "we ran out
      // of money before anything could have cleared" is a different finding from
      // "this rail does not pay", and only one of them means the lane is dead.
      const pending = windowed.pendingAttempts
        ? ` ${windowed.pendingAttempts} attempt(s) are still inside the ${windowed.settlementLagDays}-day `
          + 'clearing period and may yet settle'
        : '';
      return {
        ...base, nextState: 'DISABLED',
        reason: `spent ${usd(windowed.spendCents)} of a ${usd(budget)} probation budget with zero `
          + `verified settlements.${pending}`,
        budgetCents: budget
      };
    }
    // Matured attempts only. An attempt younger than the rail's clearing period
    // has not failed to settle — it has not had the chance to. Counting it kills
    // the lane in the week it starts working.
    if (windowed.maturedAttempts >= minAttempts) {
      return {
        ...base, nextState: 'DISABLED',
        reason: `${windowed.maturedAttempts} attempts older than this rail's ${windowed.settlementLagDays}-day `
          + 'clearing period, with zero verified settlements',
        budgetCents: budget
      };
    }
    return {
      ...base, nextState: 'PROBATION',
      reason: `on probation: ${usd(budget - windowed.spendCents)} and `
        + `${minAttempts - windowed.maturedAttempts} matured attempts remaining before automatic shutdown`
        + (windowed.pendingAttempts ? `; ${windowed.pendingAttempts} still within the ${windowed.settlementLagDays}-day clearing period` : ''),
      budgetCents: budget
    };
  }

  if (currentState === 'PROVEN') {
    if (trailing.roi != null && trailing.roi < demoteRoiThreshold) {
      return {
        ...base, nextState: 'PROBATION',
        reason: `trailing ${trailingDays}d ROI ${trailing.roi} fell below ${demoteRoiThreshold}`,
        budgetCents: budget
      };
    }
    if (economics.clearedCount >= scaleMinSettlements && economics.roi != null && economics.roi >= scaleRoiThreshold) {
      return {
        ...base, nextState: 'SCALED',
        reason: `${economics.clearedCount} cleared settlements at lifetime ROI ${economics.roi} — promoting to scaled`,
        budgetCents: null
      };
    }
    return {
      ...base, nextState: 'PROVEN',
      reason: `proven; budget is 3x trailing ${trailingDays}d cleared revenue`,
      budgetCents: Math.max(budget, trailing.clearedCents * 3)
    };
  }

  if (currentState === 'SCALED') {
    if (economics.roi != null && economics.roi < descaleRoiThreshold) {
      return {
        ...base, nextState: 'PROVEN',
        reason: `lifetime ROI ${economics.roi} fell below ${descaleRoiThreshold} — descaling`,
        budgetCents: null
      };
    }
    return { ...base, nextState: 'SCALED', reason: 'scaled; budget is uncapped within the global cap', budgetCents: null };
  }

  throw new Error(`unreachable rail state: ${currentState}`);
}

/** Evaluates a rail and writes the resulting state transition, if any. */
export async function enforceRailGovernor(options) {
  const verdict = await evaluateRailGovernor(options);
  if (verdict.nextState !== verdict.state) {
    await setRailState(verdict.rail, verdict.nextState, verdict.nextState === 'DISABLED' ? verdict.reason : null);
  }
  return verdict;
}

export async function resetGovernorMemory() {
  memoryBudget.monthlyCapCents = Number(process.env.GLOBAL_MONTHLY_BUDGET_CENTS || 50_000);
  await truncateForTesting(['global_budget']);
}
