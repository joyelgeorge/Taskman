import { railEconomics, railWindow, globalBudgetStatus } from '../ledger.js';
import { listExpenses } from './store.js';

/**
 * Turns raw ledger rows into a report a person can actually decide from.
 *
 * Every number here is arithmetic over data that already exists — rail_attempts,
 * settlements, expenses. No model touches money math anywhere in this module;
 * the one place this system is allowed to be uncertain about a number is a
 * transform's draft text, never a dollar figure.
 *
 * "projection" is a naive linear extrapolation of the trailing window, labeled
 * as exactly that. It is not a forecast and does not pretend to be one — the
 * whole system already has one example of a number that overclaimed its own
 * precision (see docs/SYSTEM_DESIGN.md §9), and this module exists partly to
 * not repeat that.
 */

const daysAgoIso = (days, now) => new Date(now.getTime() - days * 86_400_000).toISOString();

function marginPct(clearedCents, spendCents) {
  if (!clearedCents) return null;
  return Number((((clearedCents - spendCents) / clearedCents) * 100).toFixed(1));
}

export async function financeReport({ trailingDays = 30, now = new Date() } = {}) {
  const rails = await railEconomics();
  const budget = await globalBudgetStatus({ now });
  const allTimeExpenses = await listExpenses();
  const allTimeExpenseCents = allTimeExpenses.reduce((sum, e) => sum + e.amountCents, 0);

  const grossClearedCents = rails.reduce((sum, r) => sum + r.clearedCents, 0);
  const railSpendCents = rails.reduce((sum, r) => sum + r.spendCents, 0);
  const totalSpendCents = railSpendCents + allTimeExpenseCents;
  const netCents = grossClearedCents - totalSpendCents;

  const since = daysAgoIso(trailingDays, now);
  let trailingAttemptSpendCents = 0;
  let trailingClearedCents = 0;
  for (const rail of rails) {
    const windowed = await railWindow(rail.rail, since);
    trailingAttemptSpendCents += windowed.spendCents;
    trailingClearedCents += windowed.clearedCents;
  }
  const trailingExpenseCents = (await listExpenses({ since })).reduce((sum, e) => sum + e.amountCents, 0);
  const trailingSpendCents = trailingAttemptSpendCents + trailingExpenseCents;
  const trailingNetCents = trailingClearedCents - trailingSpendCents;

  const burnRateCentsPerDay = Math.round(trailingSpendCents / trailingDays);
  const runwayDays = burnRateCentsPerDay > 0 && budget.capCents > 0
    ? Math.round(budget.remainingCents / burnRateCentsPerDay)
    : null;

  const perRail = rails.map(r => ({
    rail: r.rail,
    state: r.state,
    attempts: r.attempts,
    spendCents: r.spendCents,
    clearedCents: r.clearedCents,
    netCents: r.netCents,
    marginPct: marginPct(r.clearedCents, r.spendCents),
    clearedPerAttemptCents: r.attempts ? Math.round(r.clearedCents / r.attempts) : 0
  }));

  return {
    asOf: now.toISOString(),
    lifetime: {
      grossClearedCents,
      railSpendCents,
      expenseCents: allTimeExpenseCents,
      totalSpendCents,
      netCents,
      marginPct: marginPct(grossClearedCents, totalSpendCents)
    },
    trailing: {
      days: trailingDays,
      spendCents: trailingSpendCents,
      clearedCents: trailingClearedCents,
      netCents: trailingNetCents,
      burnRateCentsPerDay
    },
    runway: {
      capCents: budget.capCents,
      remainingCents: budget.remainingCents,
      runwayDays,
      note: runwayDays == null
        ? (burnRateCentsPerDay === 0 ? 'zero burn in the trailing window — runway is not meaningful' : 'no global budget cap configured')
        : null
    },
    projection: {
      method: 'naive linear extrapolation of the trailing window — not a forecast',
      projectedNext30DaysNetCents: Math.round((trailingNetCents / trailingDays) * 30)
    },
    perRail
  };
}
