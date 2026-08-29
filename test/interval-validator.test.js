import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIntervalMinutes, normalizeBrainIntervalMinutes } from '../src/interval-validator.js';
import { createTaskRecord } from '../src/task-store.js';

test('Interval Validator: accepts valid positive integers and null/undefined', () => {
  assert.deepEqual(normalizeIntervalMinutes(undefined), { valid: true, value: null });
  assert.deepEqual(normalizeIntervalMinutes(null), { valid: true, value: null });
  assert.deepEqual(normalizeIntervalMinutes(''), { valid: true, value: null });
  assert.deepEqual(normalizeIntervalMinutes(1), { valid: true, value: 1 });
  assert.deepEqual(normalizeIntervalMinutes(10), { valid: true, value: 10 });
  assert.deepEqual(normalizeIntervalMinutes('15'), { valid: true, value: 15 });
});

test('Interval Validator: rejects negative numbers, zero, fractions, and non-numeric input', () => {
  assert.equal(normalizeIntervalMinutes(-1).valid, false);
  assert.equal(normalizeIntervalMinutes(0).valid, false);
  assert.equal(normalizeIntervalMinutes(0.5).valid, false);
  assert.equal(normalizeIntervalMinutes('abc').valid, false);
  assert.equal(normalizeIntervalMinutes(NaN).valid, false);
  assert.equal(normalizeIntervalMinutes(Infinity).valid, false);
  assert.equal(normalizeIntervalMinutes(100000).valid, false);
});

test('Task Store: rejects task creation with invalid intervalMinutes', async () => {
  await assert.rejects(
    () => createTaskRecord({
      id: crypto.randomUUID(),
      title: 'Bad interval task',
      prompt: 'do something',
      intervalMinutes: -1
    }),
    /intervalMinutes/
  );
});
