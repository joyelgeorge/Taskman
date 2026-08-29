import test from 'node:test';
import assert from 'node:assert/strict';
import { hashRequest, claimIdempotencyKey, finishIdempotentMutation } from '../src/idempotency-ledger.js';
import { migrate } from '../src/db.js';

test('Idempotency Ledger: hashes request deterministically', () => {
  const hash1 = hashRequest('/api/tasks', { title: 'Test', prompt: 'Run' });
  const hash2 = hashRequest('/api/tasks', { prompt: 'Run', title: 'Test' });
  assert.equal(hash1, hash2);
});

test('Idempotency Ledger: claims new key and replays finished mutation', async () => {
  await migrate();
  const key = `test-key-${crypto.randomUUID()}`;
  const route = '/api/tasks';
  const body = { title: 'Task 1', prompt: 'Do work' };

  const firstClaim = await claimIdempotencyKey(key, { route, body });
  assert.equal(firstClaim.shouldExecute, true);

  await finishIdempotentMutation(key, { responseStatus: 201, responseBody: { id: 'task-123', status: 'active' } });

  // Replay with identical payload
  const replayClaim = await claimIdempotencyKey(key, { route, body });
  assert.equal(replayClaim.shouldExecute, false);
  assert.equal(replayClaim.replayed, true);
  assert.equal(replayClaim.responseStatus, 201);
  assert.equal(replayClaim.responseBody.id, 'task-123');

  // Conflict on modified payload
  const conflictClaim = await claimIdempotencyKey(key, { route, body: { title: 'Task 2', prompt: 'Different' } });
  assert.equal(conflictClaim.shouldExecute, false);
  assert.equal(conflictClaim.conflict, true);
});
