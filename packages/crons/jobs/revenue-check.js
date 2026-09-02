import {
  CRON_DEFINITIONS, railEconomics, enforceRailGovernor, globalBudgetStatus,
  syncStripeSettlements, openAlert, resolveAlert
} from '@taskman/core';

export const definition = CRON_DEFINITIONS.find(c => c.cronName === 'revenue-check');

/**
 * Reconciles what the system believes it earned against what the processor says,
 * then runs every rail through the governor (docs/TARGET_DESIGN.md §8).
 *
 * The sync runs first: a rail must be judged on settled money, never on the
 * attempts it has logged. The governor's verdict is computed from rail_economics
 * and written unconditionally — promotion and demotion are never argued here,
 * only reported.
 */
export async function handler({ fetchImpl, since = null } = {}) {
  const rails = await railEconomics();
  const sync = { attempted: false, results: [] };

  if (process.env.STRIPE_API_KEY) {
    sync.attempted = true;
    for (const rail of rails.length ? rails : [{ rail: 'default' }]) {
      try {
        sync.results.push(await syncStripeSettlements({ rail: rail.rail, since, fetchImpl }));
      } catch (error) {
        sync.results.push({ rail: rail.rail, error: String(error.message || error) });
      }
    }
  }

  const verdicts = [];
  for (const rail of await railEconomics()) {
    const verdict = await enforceRailGovernor({ rail: rail.rail });
    verdicts.push(verdict);

    const component = `rail:${rail.rail}`;
    if (verdict.nextState === 'DISABLED') {
      await openAlert({
        kind: 'rail_disabled', component, severity: 'WARNING',
        message: `Rail ${rail.rail} disabled: ${verdict.reason}`, detail: verdict.economics
      });
    } else {
      await resolveAlert('rail_disabled', component);
    }

    if (verdict.state !== 'SCALED' && verdict.nextState === 'SCALED') {
      await openAlert({
        kind: 'rail_scaled', component, severity: 'INFO',
        message: `Rail ${rail.rail} promoted to SCALED: ${verdict.reason}`, detail: verdict.economics
      });
    }
  }

  const economics = await railEconomics();
  const clearedCents = economics.reduce((sum, r) => sum + r.clearedCents, 0);
  const spendCents = economics.reduce((sum, r) => sum + r.spendCents, 0);
  const budget = await globalBudgetStatus();

  if (budget.exceeded) {
    await openAlert({
      kind: 'global_budget_exceeded', component: 'global-budget', severity: 'CRITICAL',
      message: `Global monthly spend $${(budget.spentCents / 100).toFixed(2)} has reached the $${(budget.capCents / 100).toFixed(2)} cap`,
      detail: budget
    });
  } else {
    await resolveAlert('global_budget_exceeded', 'global-budget');
  }

  return {
    railCount: economics.length,
    clearedCents,
    spendCents,
    netCents: clearedCents - spendCents,
    globalBudget: budget,
    provenRails: verdicts.filter(v => ['PROVEN', 'SCALED'].includes(v.nextState)).map(v => v.rail),
    scaledRails: verdicts.filter(v => v.nextState === 'SCALED').map(v => v.rail),
    disabledRails: verdicts.filter(v => v.nextState === 'DISABLED').map(v => v.rail),
    stripeSync: sync,
    economics,
    governorVerdicts: verdicts
  };
}
