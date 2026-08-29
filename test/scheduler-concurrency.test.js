import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeWithConcurrencyPolicy,
  executeBrainWithConcurrencyPolicy,
  CONCURRENCY_POLICY
} from '../src/scheduler-concurrency.js';

test('Scheduler Concurrency: FORBID policy skips overlapping execution', async () => {
  let executions = 0;
  const task = { id: `task-concurrency-${crypto.randomUUID()}` };

  const slowTask = async () => {
    executions++;
    await new Promise(r => setTimeout(r, 50));
    return 'done';
  };

  // Launch first slow run
  const run1 = executeWithConcurrencyPolicy(task, slowTask, { policy: CONCURRENCY_POLICY.FORBID });

  // Launch second immediate run while first is in flight
  const run2 = await executeWithConcurrencyPolicy(task, slowTask, { policy: CONCURRENCY_POLICY.FORBID });

  assert.equal(run2.skipped, true);
  assert.equal(run2.reason, 'in_flight_overlap');

  await run1;
  assert.equal(executions, 1);
});

test('Scheduler Concurrency: Brain FORBID policy skips overlapping brain cycle', async () => {
  let cycles = 0;
  const slowCycle = async () => {
    cycles++;
    await new Promise(r => setTimeout(r, 50));
    return 'done';
  };

  const p1 = executeBrainWithConcurrencyPolicy(slowCycle, { policy: CONCURRENCY_POLICY.FORBID });
  const p2 = await executeBrainWithConcurrencyPolicy(slowCycle, { policy: CONCURRENCY_POLICY.FORBID });

  assert.equal(p2.skipped, true);
  assert.equal(p2.reason, 'brain_cycle_in_flight');

  await p1;
  assert.equal(cycles, 1);
});
