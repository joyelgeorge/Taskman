import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseEnabled } from '../src/db.js';
import {
  acquirePostgresExecutionSlot,
  CONCURRENCY_POLICY,
  executeBrainWithConcurrencyPolicy,
  executeWithConcurrencyPolicy,
  getConcurrencyStatus,
  normalizeConcurrencyPolicy,
  resetConcurrencyStateForTesting
} from '../src/scheduler-concurrency.js';
import { createTaskRecord } from '../src/task-store.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test.beforeEach(() => resetConcurrencyStateForTesting());

test('FORBID skips overlapping executions and never exceeds one active run', async () => {
  const gate = deferred();
  let active = 0;
  let maximum = 0;
  const execute = async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await gate.promise;
    active -= 1;
    return 'done';
  };
  const first = executeWithConcurrencyPolicy('forbid', execute);
  const second = await executeWithConcurrencyPolicy('forbid', execute);
  assert.deepEqual(second, {
    skipped: true, outcome: 'SKIPPED', reason: 'in_flight_overlap',
    policy: CONCURRENCY_POLICY.FORBID, key: 'forbid'
  });
  gate.resolve();
  assert.equal(await first, 'done');
  assert.equal(maximum, 1);
});

test('QUEUE_ONE coalesces many ticks into exactly one pending follow-up', async () => {
  const gate = deferred();
  let runs = 0;
  let active = 0;
  let maximum = 0;
  const first = executeWithConcurrencyPolicy('queue-one', async () => {
    runs += 1;
    active += 1;
    maximum = Math.max(maximum, active);
    if (runs === 1) await gate.promise;
    active -= 1;
  }, { policy: CONCURRENCY_POLICY.QUEUE_ONE });
  const ticks = await Promise.all(Array.from({ length: 5 }, () =>
    executeWithConcurrencyPolicy('queue-one', async () => {}, { policy: CONCURRENCY_POLICY.QUEUE_ONE })));
  assert.ok(ticks.every(result => result.coalesced));
  gate.resolve();
  await first;
  assert.equal(runs, 2);
  assert.equal(maximum, 1);
});

test('ALLOW is rejected unless explicitly authorized and then permits overlap', async () => {
  await assert.rejects(
    () => executeWithConcurrencyPolicy('allow', async () => {}, { policy: CONCURRENCY_POLICY.ALLOW }),
    error => error.code === 'CONCURRENT_EXECUTION_NOT_AUTHORIZED'
  );
  const gate = deferred();
  let active = 0;
  let maximum = 0;
  const execute = async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await gate.promise;
    active -= 1;
  };
  const one = executeWithConcurrencyPolicy('allow', execute, { policy: 'ALLOW', allowConcurrent: true });
  const two = executeWithConcurrencyPolicy('allow', execute, { policy: 'ALLOW', allowConcurrent: true });
  await new Promise(resolve => setImmediate(resolve));
  gate.resolve();
  await Promise.all([one, two]);
  assert.equal(maximum, 2);
});

test('unsupported policies fail closed', () => {
  assert.throws(
    () => normalizeConcurrencyPolicy('REPLACE'),
    error => error.code === 'INVALID_CONCURRENCY_POLICY'
  );
});

test('a durable overlap skips execution without fabricating success', async () => {
  let executed = false;
  const result = await executeWithConcurrencyPolicy('durable', async () => { executed = true; }, {
    acquireSlot: async () => ({ acquired: false, durable: true, release: async () => {} })
  });
  assert.equal(executed, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'durable_overlap');
  assert.equal(result.durable, true);
});

test('execution errors release the durable slot and remain failures', async () => {
  let releases = 0;
  await assert.rejects(() => executeWithConcurrencyPolicy('release', async () => {
    throw Object.assign(new Error('boom'), { code: 'EXPECTED_FAILURE' });
  }, {
    acquireSlot: async () => ({ acquired: true, durable: true, release: async () => { releases += 1; } })
  }), /boom/);
  assert.equal(releases, 1);
  assert.equal(getConcurrencyStatus()[0].lastOutcome, 'FAILED');
});

test('brain cycles use the same single-flight contract', async () => {
  const gate = deferred();
  const first = executeBrainWithConcurrencyPolicy(() => gate.promise);
  const second = await executeBrainWithConcurrencyPolicy(() => Promise.resolve());
  assert.equal(second.reason, 'in_flight_overlap');
  gate.resolve('brain-done');
  assert.equal(await first, 'brain-done');
});

test('status distinguishes started, completed, skipped, and coalesced outcomes', async () => {
  const gate = deferred();
  const first = executeWithConcurrencyPolicy('status', () => gate.promise, { policy: 'QUEUE_ONE' });
  await executeWithConcurrencyPolicy('status', async () => {}, { policy: 'QUEUE_ONE' });
  gate.resolve();
  await first;
  const status = getConcurrencyStatus().find(item => item.key === 'status');
  assert.equal(status.started, 2);
  assert.equal(status.completed, 2);
  assert.equal(status.coalesced, 1);
  assert.equal(status.skipped, 0);
});

test('task records expose the default and explicit concurrency policies', async () => {
  const defaultTask = await createTaskRecord({
    id: crypto.randomUUID(), title: 'default policy', prompt: 'test', intervalMinutes: 5
  });
  const queuedTask = await createTaskRecord({
    id: crypto.randomUUID(), title: 'queue policy', prompt: 'test', intervalMinutes: 5,
    concurrencyPolicy: 'queue_one'
  });
  const allowTask = await createTaskRecord({
    id: crypto.randomUUID(), title: 'allow policy', prompt: 'test', intervalMinutes: 5,
    concurrencyPolicy: 'allow'
  });
  assert.equal(defaultTask.concurrencyPolicy, CONCURRENCY_POLICY.FORBID);
  assert.equal(queuedTask.concurrencyPolicy, CONCURRENCY_POLICY.QUEUE_ONE);
  assert.equal(allowTask.concurrencyPolicy, CONCURRENCY_POLICY.ALLOW);
});

test('PostgreSQL advisory lock prevents overlap across independent connections', { skip: !databaseEnabled }, async () => {
  const key = `scheduler-test-${crypto.randomUUID()}`;
  const first = await acquirePostgresExecutionSlot(key);
  const second = await acquirePostgresExecutionSlot(key);
  assert.equal(first.acquired, true);
  assert.equal(first.durable, true);
  assert.equal(second.acquired, false);
  await first.release();
  const recovered = await acquirePostgresExecutionSlot(key);
  assert.equal(recovered.acquired, true);
  await recovered.release();
});

