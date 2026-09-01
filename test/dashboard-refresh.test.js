import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDashboardRefreshController,
  pollDelay,
  requestJson
} from '../public/refresh-controller.js';

test('partial endpoint failure does not block healthy panel updates', async () => {
  const controller = createDashboardRefreshController({
    panels: { status: '/status', tasks: '/tasks' },
    fetchPanel: name => name === 'tasks'
      ? Promise.reject(new Error('tasks unavailable'))
      : Promise.resolve({ ok: true })
  });

  const result = await controller.refresh();
  assert.equal(result.global.status, 'degraded');
  assert.equal(result.panels.status.status, 'live');
  assert.deepEqual(result.panels.status.data, { ok: true });
  assert.equal(result.panels.tasks.status, 'error');
  assert.match(result.panels.tasks.error, /tasks unavailable/);
});

test('total failure reports an unavailable dashboard', async () => {
  const controller = createDashboardRefreshController({
    panels: { status: '/status', tasks: '/tasks' },
    fetchPanel: () => Promise.reject(new Error('offline'))
  });

  const result = await controller.refresh();
  assert.equal(result.global.status, 'error');
  assert.deepEqual(result.global.failedPanels.sort(), ['status', 'tasks']);
});

test('late result from a superseded generation cannot overwrite current data', async () => {
  let resolveOld;
  let calls = 0;
  const oldResponse = new Promise(resolve => { resolveOld = resolve; });
  const controller = createDashboardRefreshController({
    panels: { status: '/status' },
    fetchPanel: () => ++calls === 1 ? oldResponse : Promise.resolve({ version: 2 })
  });

  const first = controller.refresh();
  const second = controller.refresh({ supersede: true });
  const current = await second;
  resolveOld({ version: 1 });
  const stale = await first;

  assert.equal(stale.ignored, true);
  assert.deepEqual(current.panels.status.data, { version: 2 });
  assert.deepEqual(controller.snapshot().panels.status.data, { version: 2 });
});

test('non-JSON responses produce a clean error without exposing response HTML', async () => {
  const html = '<html><body>private proxy details</body></html>';
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    async text() { return html; }
  });

  await assert.rejects(
    requestJson('/status', { fetchImpl }),
    error => error.code === 'INVALID_JSON_RESPONSE' &&
      error.status === 500 &&
      !error.message.includes('private proxy details')
  );
});

test('failed refresh keeps last successful data and marks it stale', async () => {
  let fail = false;
  const controller = createDashboardRefreshController({
    panels: { runs: '/runs' },
    fetchPanel: () => fail
      ? Promise.reject(new Error('temporary failure'))
      : Promise.resolve([{ id: 1 }])
  });

  const live = await controller.refresh();
  fail = true;
  const stale = await controller.refresh();

  assert.equal(live.panels.runs.status, 'live');
  assert.equal(stale.panels.runs.status, 'stale');
  assert.deepEqual(stale.panels.runs.data, [{ id: 1 }]);
  assert.ok(stale.panels.runs.lastSuccessAt);
  assert.match(stale.panels.runs.error, /temporary failure/);
});

test('hidden tabs use the reduced polling cadence', () => {
  assert.equal(pollDelay(false), 10_000);
  assert.equal(pollDelay(true), 60_000);
});
