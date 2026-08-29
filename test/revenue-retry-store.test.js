import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertRevenueRecord, claimRevenueRecords, recordRevenueFailure, redriveRevenueRecord } from '../src/revenue-store.js';

test('retry records are not claimed early and become claimable when due', async () => {
  const queue = `retry-${crypto.randomUUID()}`;
  const record = await upsertRevenueRecord({ queue, maxAttempts: 3 });
  await claimRevenueRecords(queue, { claimedBy: 'worker', now: new Date('2026-08-30T00:00:00Z') });
  const failed = await recordRevenueFailure(record.id, { status: 503 }, { now: new Date('2026-08-30T00:00:00Z'), baseMs: 1000, jitter: () => 1 });
  assert.equal(failed.status, 'RETRY_PENDING');
  assert.equal((await claimRevenueRecords(queue, { now: new Date('2026-08-30T00:00:00.999Z') })).length, 0);
  assert.equal((await claimRevenueRecords(queue, { now: new Date('2026-08-30T00:00:01Z') })).length, 1);
});

test('dead letters cannot be claimed and redrive is authorized and idempotent', async () => {
  const queue = `dead-${crypto.randomUUID()}`;
  const record = await upsertRevenueRecord({ queue, maxAttempts: 1 });
  const dead = await recordRevenueFailure(record.id, { code: 'INVALID_INPUT', message: 'sensitive payload' }, { now: new Date(0) });
  assert.equal(dead.status, 'DEAD_LETTER');
  assert.equal(dead.lastErrorCode, 'INVALID_INPUT');
  assert.equal((await claimRevenueRecords(queue)).length, 0);
  await assert.rejects(() => redriveRevenueRecord(record.id, { reason: 'fixed', idempotencyKey: 'key' }), /authorization/);
  const redriven = await redriveRevenueRecord(record.id, { authorized: true, reason: 'configuration fixed', idempotencyKey: 'key' });
  const replay = await redriveRevenueRecord(record.id, { authorized: true, reason: 'configuration fixed', idempotencyKey: 'key' });
  assert.equal(redriven.status, 'PENDING');
  assert.equal(replay.lastRedriveKeyHash, redriven.lastRedriveKeyHash);
  assert.ok(!JSON.stringify(redriven).includes('sensitive payload'));
});
