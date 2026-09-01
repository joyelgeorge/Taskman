import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyQueueFailure, retryDelayMs, retryTransition, redriveKeyDigest, safeErrorCode } from '../src/queue-retry.js';

test('classifies retryable and permanent failures without retaining messages', () => {
  assert.deepEqual(classifyQueueFailure({ code: 'ETIMEDOUT', message: 'secret' }), { code: 'ETIMEDOUT', kind: 'retryable' });
  assert.equal(classifyQueueFailure({ status: 429 }).kind, 'retryable');
  assert.equal(classifyQueueFailure({ code: 'SPEND_NOT_AUTHORIZED' }).kind, 'authorization_blocked');
  assert.equal(classifyQueueFailure({ code: 'INVALID_INPUT' }).kind, 'non_retryable');
  assert.equal(safeErrorCode({ code: 'bad value / token=secret' }), 'BAD_VALUE___TOKEN_SECRET');
});

test('uses capped exponential backoff with bounded jitter', () => {
  assert.equal(retryDelayMs(1, { baseMs: 1000, capMs: 8000, jitter: () => 0 }), 500);
  assert.equal(retryDelayMs(4, { baseMs: 1000, capMs: 8000, jitter: () => 1 }), 8000);
  assert.equal(retryDelayMs(99, { baseMs: 1000, capMs: 8000, jitter: () => 1 }), 8000);
});

test('schedules transient retries and dead-letters exhaustion', () => {
  const now = new Date('2026-08-30T00:00:00.000Z');
  const retry = retryTransition({ attemptCount: 0, maxAttempts: 2 }, { status: 503 }, { now, baseMs: 1000, jitter: () => 1 });
  assert.equal(retry.status, 'RETRY_PENDING');
  assert.equal(retry.nextAttemptAt, '2026-08-30T00:00:01.000Z');
  const exhausted = retryTransition({ attemptCount: 1, maxAttempts: 2 }, { status: 503 }, { now });
  assert.equal(exhausted.status, 'DEAD_LETTER');
  assert.equal(exhausted.nextAttemptAt, null);
  assert.equal(exhausted.deadLetteredAt, now.toISOString());
});

test('non-retryable failures dead-letter immediately and idempotency keys are hashed', () => {
  const transition = retryTransition({ attemptCount: 0, maxAttempts: 5 }, { code: 'AUTHORIZATION_DENIED' }, { now: new Date(0) });
  assert.equal(transition.status, 'DEAD_LETTER');
  assert.equal(transition.failureKind, 'authorization_blocked');
  assert.equal(redriveKeyDigest('never-store-this-key').length, 64);
  assert.ok(!redriveKeyDigest('never-store-this-key').includes('never-store'));
});
