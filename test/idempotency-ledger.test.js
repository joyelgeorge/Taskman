import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  canonicalRequestHash,
  claimIdempotencyKey,
  failIdempotentMutation,
  finishIdempotentMutation,
  resetMemoryIdempotencyLedger,
  validateIdempotencyKey
} from '../src/idempotency-ledger.js';
import { databaseEnabled, migrate, query } from '../src/db.js';

test.before(async () => {
  await resetMemoryIdempotencyLedger();
  if (databaseEnabled) await migrate();
});

test('canonical hashing is deep-order independent and route bound', () => {
  const first = canonicalRequestHash('/api/tasks', { z: [{ b: 2, a: 1 }], a: true });
  const second = canonicalRequestHash('/api/tasks', { a: true, z: [{ a: 1, b: 2 }] });
  assert.equal(first, second);
  assert.notEqual(first, canonicalRequestHash('/api/brain/run', { a: true, z: [{ a: 1, b: 2 }] }));
});

test('keys are bounded printable values', () => {
  assert.equal(validateIdempotencyKey('short'), false);
  assert.equal(validateIdempotencyKey('valid-key-123'), true);
  assert.equal(validateIdempotencyKey(`bad\nkey-value`), false);
  assert.equal(validateIdempotencyKey('x'.repeat(256)), false);
});

test('a completed mutation replays one stored result', async () => {
  const key = randomUUID();
  const options = { route: '/api/tasks', body: { title: 'one' } };
  const claimed = await claimIdempotencyKey(key, options);
  assert.equal(claimed.shouldExecute, true);
  await finishIdempotentMutation(key, {
    route: options.route,
    operationId: claimed.operationId,
    responseStatus: 201,
    responseBody: { id: 'task-one' }
  });
  const replay = await claimIdempotencyKey(key, options);
  assert.deepEqual(
    { shouldExecute: replay.shouldExecute, replayed: replay.replayed, status: replay.responseStatus, body: replay.responseBody },
    { shouldExecute: false, replayed: true, status: 201, body: { id: 'task-one' } }
  );
  if (databaseEnabled) {
    const stored = await query('SELECT key_hash FROM mutation_ledger WHERE operation_id=$1', [claimed.operationId]);
    assert.equal(stored.rowCount, 1);
    assert.notEqual(stored.rows[0].key_hash, key);
  }
});

test('same key with a different payload fails closed', async () => {
  const key = randomUUID();
  const route = '/api/revenue/queues/validated';
  await claimIdempotencyKey(key, { route, body: { id: 'one' } });
  const conflict = await claimIdempotencyKey(key, { route, body: { id: 'two' } });
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.shouldExecute, false);
});

test('concurrent claims across the shared store admit one effect', async () => {
  const key = randomUUID();
  const route = '/api/tasks/task-1/run';
  const claims = await Promise.all(Array.from({ length: 8 }, () =>
    claimIdempotencyKey(key, { route, body: null })
  ));
  assert.equal(claims.filter(result => result.shouldExecute).length, 1);
  assert.equal(claims.filter(result => result.inProgress).length, 7);
});

test('a definite pre-effect failure can be retried with the same operation key', async () => {
  const key = randomUUID();
  const route = '/api/tasks';
  const first = await claimIdempotencyKey(key, { route, body: { prompt: 'retry' } });
  await failIdempotentMutation(key, { route, operationId: first.operationId, errorCode: 'INVALID_REQUEST' });
  const retry = await claimIdempotencyKey(key, { route, body: { prompt: 'retry' } });
  assert.equal(retry.shouldExecute, true);
  assert.notEqual(retry.operationId, first.operationId);
});

test('expiry allows bounded key reuse but not a payload change before expiry', async () => {
  const key = randomUUID();
  const route = '/api/tasks';
  const now = new Date('2026-01-01T00:00:00Z');
  await claimIdempotencyKey(key, { route, body: { prompt: 'old' }, ttlMs: 60_000, now });
  const before = await claimIdempotencyKey(key, { route, body: { prompt: 'new' }, ttlMs: 60_000, now: new Date(now.getTime() + 30_000) });
  assert.equal(before.conflict, true);
  const after = await claimIdempotencyKey(key, { route, body: { prompt: 'new' }, ttlMs: 60_000, now: new Date(now.getTime() + 61_000) });
  assert.equal(after.shouldExecute, true);
});
