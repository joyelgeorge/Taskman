import test from 'node:test';
import assert from 'node:assert/strict';
import { recordExpense, listExpenses, resetFinanceMemory } from '../finance/store.js';
import { financeReport } from '../finance/report.js';
import {
  recordAttempt, recordSettlement, setGlobalMonthlyBudget, resetLedgerMemory, resetGovernorMemory,
  SETTLEMENT_STATUS
} from '../ledger.js';

async function reset() { await resetFinanceMemory(); await resetLedgerMemory(); await resetGovernorMemory(); }

// ---- store -------------------------------------------------------------------

test('an unknown expense category is rejected', async () => {
  await reset();
  await assert.rejects(() => recordExpense({ category: 'yacht', amountCents: 100 }), /category must be one of/);
});

test('a non-positive expense amount is rejected', async () => {
  await reset();
  await assert.rejects(() => recordExpense({ category: 'infra', amountCents: 0 }), /positive amount/);
});

test('expenses can be filtered by category and campaign', async () => {
  await reset();
  await recordExpense({ category: 'infra', amountCents: 500 });
  await recordExpense({ category: 'marketing', amountCents: 300, campaignKey: 'unclaimed-funds' });
  await recordExpense({ category: 'marketing', amountCents: 200, campaignKey: 'other-campaign' });

  assert.equal((await listExpenses({ category: 'infra' })).length, 1);
  assert.equal((await listExpenses({ campaignKey: 'unclaimed-funds' })).length, 1);
  assert.equal((await listExpenses()).length, 3);
});

// ---- report: no data at all --------------------------------------------------

test('a completely empty ledger produces a report that says so, not an error', async () => {
  await reset();
  const report = await financeReport({});
  assert.equal(report.lifetime.netCents, 0);
  assert.equal(report.lifetime.marginPct, null, 'margin is undefined, not zero, when there is no revenue to divide by');
  assert.equal(report.trailing.burnRateCentsPerDay, 0);
  assert.equal(report.runway.runwayDays, null);
  assert.match(report.runway.note, /zero burn/);
});

// ---- report: real numbers ----------------------------------------------------

test('lifetime net position combines rail spend, expenses, and cleared settlements correctly', async () => {
  await reset();
  await recordAttempt({ rail: 'r', costCents: 1000 });
  await recordSettlement({ rail: 'r', source: 'stripe', externalRef: 'txn_1', grossCents: 5000, feeCents: 200, status: SETTLEMENT_STATUS.CLEARED });
  await recordExpense({ category: 'infra', amountCents: 800 });

  const report = await financeReport({});
  // cleared: 5000-200=4800. spend: 1000 (rail) + 800 (expense) = 1800. net = 3000.
  assert.equal(report.lifetime.grossClearedCents, 4800);
  assert.equal(report.lifetime.totalSpendCents, 1800);
  assert.equal(report.lifetime.netCents, 3000);
  assert.equal(report.lifetime.marginPct, Number((3000 / 4800 * 100).toFixed(1)));
});

test('pending settlements never enter the finance report as earned', async () => {
  await reset();
  await recordAttempt({ rail: 'r', costCents: 100 });
  await recordSettlement({ rail: 'r', source: 'stripe', externalRef: 'txn_pending', grossCents: 99999 });

  const report = await financeReport({});
  assert.equal(report.lifetime.grossClearedCents, 0, 'a pending settlement must not appear as cleared revenue');
  assert.equal(report.lifetime.netCents, -100);
});

test('burn rate and runway are computed from the trailing window against the global cap', async () => {
  await reset();
  await setGlobalMonthlyBudget(10000);
  await recordAttempt({ rail: 'r', costCents: 3000 });

  const report = await financeReport({ trailingDays: 30 });
  assert.equal(report.trailing.spendCents, 3000);
  assert.equal(report.trailing.burnRateCentsPerDay, 100); // 3000 / 30
  // remaining budget 7000 / burn 100/day = 70 days
  assert.equal(report.runway.runwayDays, 70);
});

test('marketing expenses tagged to a campaign roll into the same report as rail spend', async () => {
  await reset();
  await recordAttempt({ rail: 'r', costCents: 500 });
  await recordExpense({ category: 'marketing', amountCents: 250, campaignKey: 'unclaimed-funds' });

  const report = await financeReport({});
  assert.equal(report.lifetime.railSpendCents, 500);
  assert.equal(report.lifetime.expenseCents, 250);
  assert.equal(report.lifetime.totalSpendCents, 750);
});

test('per-rail margin and cleared-per-attempt are reported alongside the raw ledger numbers', async () => {
  await reset();
  for (let i = 0; i < 4; i += 1) await recordAttempt({ rail: 'r', costCents: 250 });
  await recordSettlement({ rail: 'r', source: 'stripe', externalRef: 'txn_1', grossCents: 2000, status: SETTLEMENT_STATUS.CLEARED });

  const report = await financeReport({});
  const rail = report.perRail.find(r => r.rail === 'r');
  assert.equal(rail.attempts, 4);
  assert.equal(rail.clearedPerAttemptCents, 500); // 2000 / 4
  assert.equal(rail.marginPct, Number(((2000 - 1000) / 2000 * 100).toFixed(1)));
});

test('the projection is explicitly labeled as a naive extrapolation, never presented as a forecast', async () => {
  await reset();
  const report = await financeReport({});
  assert.match(report.projection.method, /not a forecast/);
});

test('financeReport converts cleared USD settlements to INR at historical observed ECB cross rate', async () => {
  await reset();
  const { recordObservations, rollupDay, resetObservationMemory, registerSource } = await import('../observations/store.js');
  await resetObservationMemory();
  // observations.source_key is a foreign key; the collector always registers the
  // source before it records a point against it.
  await registerSource({
    sourceKey: 'ecb-euro-reference-rates',
    url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    kind: 'http_xml',
    licence: 'ECB reference rates, free reuse with attribution',
    decision: 'FX cross rates for settlement conversion'
  });

  // Record observations for 2026-09-01
  await recordObservations('ecb-euro-reference-rates', [
    { seriesKey: 'fx.eur.USD', valueNum: 1.0850, observedAt: '2026-09-01T16:00:00Z' },
    { seriesKey: 'fx.eur.INR', valueNum: 95.4200, observedAt: '2026-09-01T16:00:00Z' }
  ]);
  await rollupDay({ date: '2026-09-01' });

  // Record cleared settlement verified on 2026-09-01
  // USD 100 net = 10000 cents.
  await recordSettlement({
    rail: 'r',
    source: 'stripe',
    externalRef: 'txn_fx_1',
    grossCents: 10000,
    feeCents: 0,
    currency: 'USD',
    status: SETTLEMENT_STATUS.CLEARED,
    verifiedAt: '2026-09-01T18:00:00Z'
  });

  const report = await financeReport({});
  assert.equal(report.lifetime.grossClearedCents, 10000);
  assert.ok(report.lifetime.grossClearedInrPaise > 0);
  assert.equal(report.lifetime.fxConversions.length, 1);
  assert.equal(report.lifetime.fxConversions[0].derived, true);
  assert.equal(report.lifetime.fxConversions[0].currency, 'USD');
  // rate = 95.4200 / 1.0850 = 87.9447
  assert.equal(Number(report.lifetime.fxConversions[0].rate.toFixed(2)), 87.94);
});
