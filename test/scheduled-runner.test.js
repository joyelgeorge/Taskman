import test from 'node:test';
import assert from 'node:assert/strict';
import { runClaimedSchedule } from '../src/scheduled-runner.js';

const claim = {
  job: { id: 'taskman-execute-hourly' },
  runKey: 'taskman-execute-hourly:2026-08-29T10:20:00Z',
  leaseToken: 'lease-token-b',
  claimedBy: 'worker-b'
};

test('scheduled runner forwards the claim fencing token on successful finish', async () => {
  let finished;
  const outcome = await runClaimedSchedule({
    claim,
    workerName: 'execute',
    runWorker: async ({ claimedBy }) => ({ claimedBy, processed: 1 }),
    finish: async input => { finished = input; return { ok: true }; },
    renew: async () => ({ ok: true }),
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {}
  });
  assert.equal(outcome.ok, true);
  assert.equal(finished.leaseToken, claim.leaseToken);
  assert.equal(finished.status, 'COMPLETED');
});

test('scheduled runner renews a long-running worker lease with the same token', async () => {
  let heartbeat;
  const renewals = [];
  await runClaimedSchedule({
    claim,
    workerName: 'execute',
    runWorker: async () => { await heartbeat(); return { processed: 1 }; },
    finish: async () => ({ ok: true }),
    renew: async input => { renewals.push(input); return { ok: true }; },
    setIntervalFn: callback => { heartbeat = callback; return { unref() {} }; },
    clearIntervalFn: () => {}
  });
  assert.equal(renewals.length, 1);
  assert.equal(renewals[0].leaseToken, claim.leaseToken);
  assert.equal(renewals[0].jobId, claim.job.id);
});

test('stale completion cannot clear a reclaimed lease through the runner', async () => {
  let finishInput;
  const outcome = await runClaimedSchedule({
    claim,
    workerName: 'execute',
    runWorker: async () => ({ processed: 1 }),
    finish: async input => {
      finishInput = input;
      return { ok: false, fenced: true, reason: 'lease token mismatch' };
    },
    renew: async () => ({ ok: true }),
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {}
  });
  assert.equal(finishInput.leaseToken, claim.leaseToken);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.finishResult.fenced, true);
});

test('scheduled runner fails closed after lease-renewal failure', async () => {
  let heartbeat;
  let finishInput;
  const outcome = await runClaimedSchedule({
    claim,
    workerName: 'validate',
    runWorker: async () => { await heartbeat(); return { promoted: 1 }; },
    finish: async input => { finishInput = input; return { ok: false, fenced: true }; },
    renew: async () => ({ ok: false, fenced: true, reason: 'lease was reclaimed' }),
    setIntervalFn: callback => { heartbeat = callback; return { unref() {} }; },
    clearIntervalFn: () => {}
  });
  assert.equal(finishInput.status, 'FAILED');
  assert.match(finishInput.error, /lease was reclaimed/);
  assert.equal(outcome.ok, false);
});
