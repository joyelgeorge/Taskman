import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recordAttempt,
  finishAttempt,
  recordSettlement,
  markSettlementCleared,
  railEconomics,
  evaluateRailViability,
  enforceRailViability,
  setRailEnabled,
  isRailEnabled,
  resetLedgerMemory,
  SETTLEMENT_STATUS,
  ATTEMPT_STATUS
} from '../src/money-ledger.js';

import {
  normalizeStripeTransaction,
  syncStripeSettlements
} from '../src/settlement-verifier.js';

import { upsertRevenueRecord } from '../src/revenue-store.js';
import { runExecuteWorker } from '../src/workers/execute.js';
import { CANONICAL_QUEUES } from '../src/orchestration-profiles.js';

test('a settlement from an unverifiable source is rejected', async () => {
  await resetLedgerMemory();
  await assert.rejects(
    () => recordSettlement({ rail: 'r', source: 'vibes', externalRef: 'x1', grossCents: 5000 }),
    /self-reported revenue is not accepted/
  );
});

test('a settlement with no external reference is rejected', async () => {
  await resetLedgerMemory();
  await assert.rejects(
    () => recordSettlement({ rail: 'r', source: 'stripe', externalRef: '  ', grossCents: 5000 }),
    /externalRef is required/
  );
});

test('the same processor reference cannot be counted twice', async () => {
  await resetLedgerMemory();
  const first = await recordSettlement({
    rail: 'r', source: 'stripe', externalRef: 'txn_1', grossCents: 5000, feeCents: 175,
    status: SETTLEMENT_STATUS.CLEARED
  });
  const second = await recordSettlement({
    rail: 'r', source: 'stripe', externalRef: 'txn_1', grossCents: 5000, feeCents: 175,
    status: SETTLEMENT_STATUS.CLEARED
  });
  assert.equal(first.id, second.id);

  const [economics] = await railEconomics('r');
  assert.equal(economics.clearedCount, 1);
  assert.equal(economics.clearedCents, 4825);
});

test('economics net spend against cleared settlements only', async () => {
  await resetLedgerMemory();
  const a1 = await recordAttempt({ rail: 'r', costCents: 120 });
  await finishAttempt(a1.id, { status: ATTEMPT_STATUS.DELIVERED });
  await recordAttempt({ rail: 'r', costCents: 80 });

  await recordSettlement({ rail: 'r', source: 'stripe', externalRef: 'cleared_1', grossCents: 1000, status: SETTLEMENT_STATUS.CLEARED });
  await recordSettlement({ rail: 'r', source: 'stripe', externalRef: 'pending_1', grossCents: 9999 });

  const [e] = await railEconomics('r');
  assert.equal(e.attempts, 2);
  assert.equal(e.spendCents, 200);
  assert.equal(e.clearedCents, 1000);
  assert.equal(e.pendingCents, 9999, 'pending money is tracked but never counted as earned');
  assert.equal(e.netCents, 800);
});

test('a rail that spends its probation budget without settling is disabled', async () => {
  await resetLedgerMemory();
  for (let i = 0; i < 5; i += 1) {
    await recordAttempt({ rail: 'deadrail', costCents: 400 });
  }
  const verdict = await evaluateRailViability({ rail: 'deadrail', probationBudgetCents: 2000, minAttempts: 100 });
  assert.equal(verdict.verdict, 'DISABLE');
  assert.match(verdict.reason, /zero verified settlements/);
});

test('a rail that exhausts its attempt allowance without settling is disabled', async () => {
  await resetLedgerMemory();
  for (let i = 0; i < 4; i += 1) {
    await recordAttempt({ rail: 'deadrail', costCents: 0 });
  }
  const verdict = await evaluateRailViability({ rail: 'deadrail', probationBudgetCents: 100000, minAttempts: 4 });
  assert.equal(verdict.verdict, 'DISABLE');
  assert.match(verdict.reason, /4 attempts/);
});

test('a rail with a verified settlement keeps running', async () => {
  await resetLedgerMemory();
  for (let i = 0; i < 40; i += 1) await recordAttempt({ rail: 'live', costCents: 100 });
  await recordSettlement({ rail: 'live', source: 'stripe', externalRef: 'txn_live', grossCents: 25000, status: SETTLEMENT_STATUS.CLEARED });

  const verdict = await evaluateRailViability({ rail: 'live', probationBudgetCents: 1000, minAttempts: 5 });
  assert.equal(verdict.verdict, 'CONTINUE');
  assert.equal(verdict.proven, true);
});

test('enforcing viability actually switches the rail off', async () => {
  await resetLedgerMemory();
  await recordAttempt({ rail: 'doomed', costCents: 9000 });
  const verdict = await enforceRailViability({ rail: 'doomed', probationBudgetCents: 5000 });
  assert.equal(verdict.verdict, 'DISABLE');
  assert.equal(await isRailEnabled('doomed'), false);
});

test('a pending stripe transaction is not counted as earned', () => {
  const pending = normalizeStripeTransaction({ id: 'txn_p', amount: 5000, fee: 175, currency: 'usd', status: 'pending' }, 'r');
  assert.equal(pending.status, SETTLEMENT_STATUS.PENDING);

  const available = normalizeStripeTransaction({ id: 'txn_a', amount: 5000, fee: 175, currency: 'usd', status: 'available' }, 'r');
  assert.equal(available.status, SETTLEMENT_STATUS.CLEARED);
  assert.equal(available.externalRef, 'txn_a');
});

test('stripe sync records balance transactions and skips refunds', async () => {
  await resetLedgerMemory();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      data: [
        { id: 'txn_ok', amount: 12000, fee: 378, currency: 'usd', status: 'available', type: 'charge' },
        { id: 'txn_refund', amount: -4000, fee: 0, currency: 'usd', status: 'available', type: 'charge' }
      ]
    })
  });

  const result = await syncStripeSettlements({ rail: 'consulting', apiKey: 'sk_test_x', fetchImpl });
  assert.equal(result.scanned, 2);
  assert.equal(result.recordedCount, 1);
  assert.equal(result.clearedCount, 1);
  assert.equal(result.skipped.length, 1);

  const [e] = await railEconomics('consulting');
  assert.equal(e.clearedCents, 11622);
});

test('the execute worker refuses to claim work for a disabled rail', async () => {
  await resetLedgerMemory();
  await setRailEnabled('offrail', false, 'no verified settlements');
  const result = await runExecuteWorker({ rail: 'offrail' });
  assert.equal(result.status, 'RAIL_DISABLED');
  assert.equal(result.claimedCount, 0);
});

test('an executor that claims revenue without a settlement earns zero', async () => {
  await resetLedgerMemory();
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.execution,
    noveltyKey: 'unbacked-claim',
    status: 'NEW',
    payload: { candidate: { candidateId: 'c1', noveltyKey: 'unbacked-claim', title: 'Invented payday' }, missingCapabilities: [] }
  });

  const result = await runExecuteWorker({
    rail: 'honest',
    limit: 1,
    executorFn: async () => ({ status: 'COMPLETED', attributableValue: 9999, verifiedAttributableValue: 9999 })
  });

  assert.equal(result.outcomesCount, 1);
  assert.equal(result.outcomes[0].payload.attributableValue, 0);
});

test('an executor returning a cleared settlement produces a money event', async () => {
  await resetLedgerMemory();
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.execution,
    noveltyKey: 'real-payday',
    status: 'NEW',
    payload: { candidate: { candidateId: 'c2', noveltyKey: 'real-payday', title: 'Delivered audit' }, missingCapabilities: [] }
  });

  const result = await runExecuteWorker({
    rail: 'honest',
    limit: 1,
    executorFn: async () => ({
      status: 'COMPLETED',
      settlement: {
        source: 'stripe',
        externalRef: 'txn_real_1',
        grossCents: 30000,
        feeCents: 900,
        status: SETTLEMENT_STATUS.CLEARED
      }
    })
  });

  const outcome = result.outcomes.find(o => o.payload.candidateId === 'c2');
  assert.equal(outcome.payload.outcomeStatus, 'MONEY_EVENT');
  assert.equal(outcome.payload.attributableValue, 291);
  assert.equal(result.viability.proven, true);
});
