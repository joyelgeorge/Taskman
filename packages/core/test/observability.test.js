import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerCron, startCronRun, finishCronRun, cronStatuses, listCronRuns, resetCronMemory
} from '../observability/cron-store.js';
import { openAlert, resolveAlert, listAlerts, resetAlertMemory } from '../observability/alerts.js';
import { runHealthChecks, resetHealthMemory } from '../health/index.js';
import { resetDroneMemory, registerDrone } from '../drones/store.js';

async function reset() { await resetCronMemory(); await resetAlertMemory(); await resetHealthMemory(); await resetDroneMemory(); }

const definition = { cronName: 'demo', schedule: '*/15 * * * *', maxSilenceSeconds: 3600 };

test('the same slot cannot run twice', async () => {
  await reset();
  await registerCron(definition);
  const first = await startCronRun({ cronName: 'demo', runKey: 'slot-1' });
  const second = await startCronRun({ cronName: 'demo', runKey: 'slot-1' });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.run.id, first.run.id);
});

test('a cron that has never run reads as OVERDUE', async () => {
  await reset();
  await registerCron(definition);
  const [status] = await cronStatuses();
  assert.equal(status.status, 'OVERDUE');
  assert.equal(status.lastRunAt, null);
});

test('silence beyond the tolerance is detected', async () => {
  await reset();
  await registerCron(definition);
  const { run } = await startCronRun({ cronName: 'demo', runKey: 'slot-1' });
  await finishCronRun(run.id, { status: 'COMPLETED', durationMs: 10 });

  const [healthy] = await cronStatuses();
  assert.equal(healthy.status, 'OK');

  const [overdue] = await cronStatuses({ now: new Date(Date.now() + 4000 * 1000) });
  assert.equal(overdue.status, 'OVERDUE');
  assert.ok(overdue.silentSeconds > 3600);
});

test('a failed run surfaces as FAILING with its error', async () => {
  await reset();
  await registerCron(definition);
  const { run } = await startCronRun({ cronName: 'demo', runKey: 'slot-2' });
  await finishCronRun(run.id, { status: 'FAILED', error: 'boom', durationMs: 5 });

  const [status] = await cronStatuses();
  assert.equal(status.status, 'FAILING');
  assert.equal(status.lastError, 'boom');
  assert.equal((await listCronRuns({ cronName: 'demo' })).length, 1);
});

test('an alert opens once and resolves when the component recovers', async () => {
  await reset();
  const first = await openAlert({ kind: 'component_down', component: 'db', message: 'db is DOWN' });
  const second = await openAlert({ kind: 'component_down', component: 'db', message: 'db is DOWN again' });
  assert.equal(first.created, true);
  assert.equal(second.created, false, 'a component down for hours pages once, not hourly');
  assert.equal((await listAlerts({ open: true })).length, 1);

  await resolveAlert('component_down', 'db');
  assert.equal((await listAlerts({ open: true })).length, 0);
});

test('health checks cover db, drones and crons, and reconcile alerts', async () => {
  await reset();
  await registerCron(definition);
  await registerDrone({ id: 'd1', kind: 'rss', name: 'feed', targetUrl: 'https://x/feed' });

  const report = await runHealthChecks({});
  const components = report.checks.map(c => c.component);
  assert.ok(components.includes('db'));
  assert.ok(components.includes('drone:d1'));
  assert.ok(components.includes('cron:demo'));

  // The never-run cron is DOWN, so the overall verdict must not be OK.
  assert.equal(report.overall, 'DOWN');
  const alerts = await listAlerts({ open: true });
  assert.ok(alerts.some(a => a.component === 'cron:demo'));
});
