import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordFinanceReportSnapshot, listFinanceReportHistory, snapshotFinanceReport,
  resetFinanceMemory, recordExpense
} from '../finance/index.js';
import {
  recordAttempt, recordSettlement, resetLedgerMemory, resetGovernorMemory,
  setGlobalMonthlyBudget, SETTLEMENT_STATUS
} from '../ledger.js';

async function reset() {
  await resetFinanceMemory();
  await resetLedgerMemory();
  await resetGovernorMemory();
}

test('recordFinanceReportSnapshot writes and normalizes history snapshots', async () => {
  await reset();
  const mockReport = {
    lifetime: { grossClearedCents: 5000, railSpendCents: 1000, expenseCents: 500, totalSpendCents: 1500, netCents: 3500, marginPct: 70.0 },
    trailing: { burnRateCentsPerDay: 50 },
    runway: { runwayDays: 100 }
  };

  const saved = await recordFinanceReportSnapshot({ date: '2026-09-01', report: mockReport });
  assert.equal(saved.snapshotDate, '2026-09-01');
  assert.equal(saved.netCents, 3500);
  assert.equal(saved.totalSpendCents, 1500);
  assert.equal(saved.grossClearedCents, 5000);
  assert.equal(saved.burnRateCentsPerDay, 50);
  assert.equal(saved.runwayDays, 100);
  assert.equal(saved.marginPct, 70.0);
  assert.equal(saved.reportPayload.lifetime.netCents, 3500);

  const history = await listFinanceReportHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].snapshotDate, '2026-09-01');
  assert.equal(history[0].netCents, 3500);
});

test('snapshots are idempotent by snapshotDate — re-recording updates rather than duplicates', async () => {
  await reset();
  await recordFinanceReportSnapshot({
    date: '2026-09-02',
    report: { lifetime: { netCents: 1000 }, trailing: { burnRateCentsPerDay: 20 }, runway: { runwayDays: 50 } }
  });

  await recordFinanceReportSnapshot({
    date: '2026-09-02',
    report: { lifetime: { netCents: 2000 }, trailing: { burnRateCentsPerDay: 40 }, runway: { runwayDays: 25 } }
  });

  const history = await listFinanceReportHistory();
  assert.equal(history.length, 1, 'duplicate date must update existing row, not add a new one');
  assert.equal(history[0].netCents, 2000);
  assert.equal(history[0].burnRateCentsPerDay, 40);
  assert.equal(history[0].runwayDays, 25);
});

test('listFinanceReportHistory filters by since and limits results in descending chronological order', async () => {
  await reset();
  const dates = ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'];
  for (let i = 0; i < dates.length; i += 1) {
    await recordFinanceReportSnapshot({
      date: dates[i],
      report: { lifetime: { netCents: (i + 1) * 100 } }
    });
  }

  const allDesc = await listFinanceReportHistory({ limit: 10 });
  assert.equal(allDesc.length, 5);
  assert.deepEqual(allDesc.map(h => h.snapshotDate), ['2026-09-03', '2026-09-02', '2026-09-01', '2026-08-31', '2026-08-30']);

  const limited = await listFinanceReportHistory({ limit: 2 });
  assert.equal(limited.length, 2);
  assert.deepEqual(limited.map(h => h.snapshotDate), ['2026-09-03', '2026-09-02']);

  const since = await listFinanceReportHistory({ since: '2026-09-01' });
  assert.equal(since.length, 3);
  assert.deepEqual(since.map(h => h.snapshotDate), ['2026-09-03', '2026-09-02', '2026-09-01']);
});

test('snapshotFinanceReport computes live report and records snapshot accurately', async () => {
  await reset();
  await setGlobalMonthlyBudget(10000);
  await recordAttempt({ rail: 'demo', costCents: 500 });
  await recordSettlement({
    rail: 'demo', source: 'stripe', externalRef: 'txn_snap_1',
    grossCents: 2000, feeCents: 100, status: SETTLEMENT_STATUS.CLEARED
  });
  await recordExpense({ category: 'infra', amountCents: 300 });

  const now = new Date('2026-09-04T12:00:00Z');
  const summary = await snapshotFinanceReport({ now, trailingDays: 30 });

  assert.equal(summary.snapshotDate, '2026-09-04');
  assert.equal(summary.grossClearedCents, 1900); // 2000 - 100
  assert.equal(summary.totalSpendCents, 800); // 500 + 300
  assert.equal(summary.netCents, 1100); // 1900 - 800
  assert.ok(summary.snapshotId);

  const history = await listFinanceReportHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].snapshotDate, '2026-09-04');
  assert.equal(history[0].netCents, 1100);
});

test('resetFinanceMemory clears snapshot history', async () => {
  await reset();
  await recordFinanceReportSnapshot({
    date: '2026-09-05',
    report: { lifetime: { netCents: 500 } }
  });
  assert.equal((await listFinanceReportHistory()).length, 1);

  await resetFinanceMemory();
  assert.equal((await listFinanceReportHistory()).length, 0);
});
