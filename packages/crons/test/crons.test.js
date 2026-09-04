import test from 'node:test';
import assert from 'node:assert/strict';
import { slotSeconds, runKeyFor } from '../lib/slot.js';
import { runCron } from '../lib/run.js';
import { cronNames, getJob } from '../registry.js';
import { CRON_DEFINITIONS, cronStatuses, listCronRuns, resetCronMemory, resetAlertMemory, listAlerts,
         registerCron, resetDroneMemory, resetSignalMemory, resetScanMemory, DEFAULT_TARGETS } from '@taskman/core';

async function reset() { await resetCronMemory(); await resetAlertMemory(); await resetDroneMemory(); await resetSignalMemory(); await resetScanMemory(); }

test('slot length is derived from the cron expression', () => {
  assert.equal(slotSeconds('*/15 * * * *'), 900);
  assert.equal(slotSeconds('*/20 * * * *'), 1200);
  assert.equal(slotSeconds('0 * * * *'), 3600);
  assert.equal(slotSeconds('0 */6 * * *'), 21600);
  assert.equal(slotSeconds('0 3 * * *'), 86400);
});

test('two moments inside one slot share a run key', () => {
  const a = runKeyFor('*/15 * * * *', new Date('2026-09-02T10:01:00Z'));
  const b = runKeyFor('*/15 * * * *', new Date('2026-09-02T10:14:59Z'));
  const c = runKeyFor('*/15 * * * *', new Date('2026-09-02T10:15:00Z'));
  assert.equal(a, b, 'same slot must collapse');
  assert.notEqual(b, c, 'the next slot must run');
});

test('every declared cron has a registered job and a watchdog threshold', () => {
  for (const definition of CRON_DEFINITIONS) {
    assert.ok(cronNames.includes(definition.cronName), `${definition.cronName} has no job`);
    assert.ok(definition.maxSilenceSeconds > slotSeconds(definition.schedule),
      `${definition.cronName} tolerance must exceed its own interval`);
    assert.doesNotThrow(() => getJob(definition.cronName));
  }
});

test('a cron run is recorded, and the same slot will not run twice', async () => {
  await reset();
  const definition = { cronName: 'demo', schedule: '*/15 * * * *', maxSilenceSeconds: 3600 };
  const now = new Date('2026-09-02T10:00:00Z');
  let calls = 0;

  const first = await runCron(definition, async () => { calls += 1; return { did: 'work' }; }, { now });
  const second = await runCron(definition, async () => { calls += 1; return { did: 'work' }; }, { now });

  assert.equal(first.status, 'COMPLETED');
  assert.equal(second.status, 'SKIPPED');
  assert.equal(calls, 1, 'the handler must not run twice in one slot');
  assert.equal((await listCronRuns({ cronName: 'demo' })).length, 1);
});

test('--force runs regardless of slot', async () => {
  await reset();
  const definition = { cronName: 'demo', schedule: '*/15 * * * *', maxSilenceSeconds: 3600 };
  const now = new Date('2026-09-02T10:00:00Z');
  await runCron(definition, async () => ({}), { now });
  const forced = await runCron(definition, async () => ({}), { now, force: true });
  assert.equal(forced.status, 'COMPLETED');
});

test('a throwing handler is recorded as FAILED rather than lost', async () => {
  await reset();
  const definition = { cronName: 'boomer', schedule: '0 * * * *', maxSilenceSeconds: 7200 };
  const outcome = await runCron(definition, async () => { throw new Error('upstream exploded'); });

  assert.equal(outcome.status, 'FAILED');
  assert.match(outcome.error, /upstream exploded/);

  const [status] = (await cronStatuses()).filter(c => c.cronName === 'boomer');
  assert.equal(status.status, 'FAILING');
});

test('the watchdog opens an alert for a silent cron and clears it on recovery', async () => {
  await reset();
  const monitor = getJob('cron-monitor');
  await registerCron({ cronName: 'ghost', schedule: '*/15 * * * *', maxSilenceSeconds: 900 });

  const report = await monitor.handler({});
  assert.ok(report.unhealthy.some(c => c.cron === 'ghost'));
  assert.ok((await listAlerts({ open: true })).some(a => a.component === 'cron:ghost'));

  // The cron starts running again; the alert must clear itself.
  await runCron({ cronName: 'ghost', schedule: '*/15 * * * *', maxSilenceSeconds: 900 }, async () => ({}));
  const recovered = await monitor.handler({});
  assert.ok(recovered.alertsResolved.includes('cron:ghost'));
  assert.equal((await listAlerts({ open: true })).some(a => a.component === 'cron:ghost'), false);
});

test('drone-dispatch seeds the default fleet on an empty install', async () => {
  await reset();
  const job = getJob('drone-dispatch');
  const result = await job.handler({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"hits":[]}' }) });
  assert.ok(result.dispatched >= 3, 'the default fleet should be registered and flown');
});

test('satellite-scan seeds the three hand-checked venues on an empty install and scans each once', async () => {
  await reset();
  const job = getJob('satellite-scan');
  const result = await job.handler({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => `<title>x</title>${'x'.repeat(500)}` })
  });
  assert.equal(result.scanned, DEFAULT_TARGETS.length);
});
