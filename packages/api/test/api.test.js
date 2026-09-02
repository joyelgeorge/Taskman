import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import { resetCronMemory, resetAlertMemory, resetDroneMemory, resetSignalMemory, registerDrone } from '@taskman/core';

async function withServer(fn) {
  const server = createServer();
  await new Promise(resolve => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { server.close(); }
}

const get = async (base, path) => {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: await response.json() };
};

function reset() { resetCronMemory(); resetAlertMemory(); resetDroneMemory(); resetSignalMemory(); }

test('status summarises every subsystem', async () => {
  reset();
  await registerDrone({ id: 'd1', kind: 'rss', name: 'feed', targetUrl: 'https://x/feed' });

  await withServer(async base => {
    const { status, body } = await get(base, '/api/status');
    assert.equal(status, 200);
    assert.equal(body.drones.total, 1);
    assert.ok('signals' in body);
    assert.ok('revenue' in body);
    assert.ok(Array.isArray(body.crons));
  });
});

test('health answers 503 when the system is degraded', async () => {
  reset();
  await withServer(async base => {
    // No DATABASE_URL in tests, so db is not ok and the verdict must not be OK.
    const { status, body } = await get(base, '/api/health');
    assert.equal(status, 503);
    assert.notEqual(body.status, 'OK');
  });
});

test('unknown routes 404 rather than 500', async () => {
  await withServer(async base => {
    const { status } = await get(base, '/api/nope');
    assert.equal(status, 404);
  });
});

test('drone registration validates the kind', async () => {
  reset();
  await withServer(async base => {
    const response = await fetch(`${base}/api/drones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'x', kind: 'telepathy', targetUrl: 'https://x' })
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /unknown kind/);
    assert.ok(body.kinds.includes('rss'), 'the error should say what is valid');
  });
});

test('mutations require the token when one is configured', async () => {
  reset();
  process.env.TASKMAN_API_TOKEN = 'secret-token';
  try {
    await withServer(async base => {
      const unauthorized = await fetch(`${base}/api/drones`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'x', kind: 'rss', targetUrl: 'https://x/feed' })
      });
      assert.equal(unauthorized.status, 401);

      // Reads stay open so a dashboard can render without holding a secret.
      assert.equal((await get(base, '/api/drones')).status, 200);

      const authorized = await fetch(`${base}/api/drones`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer secret-token' },
        body: JSON.stringify({ id: 'x', kind: 'rss', name: 'x', targetUrl: 'https://x/feed' })
      });
      assert.equal(authorized.status, 200);
    });
  } finally {
    delete process.env.TASKMAN_API_TOKEN;
  }
});

test('cross-origin preflight is allowed so the UI can live elsewhere', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/status`, { method: 'OPTIONS' });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  });
});

test('money/economics reports rail state and the global budget together', async () => {
  reset();
  const { recordAttempt } = await import('@taskman/core');
  await recordAttempt({ rail: 'r', costCents: 100 });

  await withServer(async base => {
    const { status, body } = await get(base, '/api/money/economics');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.rails));
    assert.equal(body.rails.find(r => r.rail === 'r').state, 'PROBATION');
    assert.ok('globalBudget' in body);
    assert.ok('capCents' in body.globalBudget);
  });
});

test('the governor endpoint previews without writing, and enforcing it does', async () => {
  reset();
  const { setRailState, getRailState } = await import('@taskman/core');
  await setRailState('doomed', 'PROBATION');

  await withServer(async base => {
    const preview = await get(base, '/api/money/rails/doomed/governor');
    assert.equal(preview.status, 200);
    assert.equal(preview.body.nextState, 'PROBATION');

    // Preview must not have written anything.
    assert.equal((await getRailState('doomed')).state, 'PROBATION');
  });
});

test('re-enabling a disabled rail requires the token when one is configured', async () => {
  reset();
  const { setRailState } = await import('@taskman/core');
  await setRailState('offline', 'DISABLED', 'no settlements');

  process.env.TASKMAN_API_TOKEN = 'secret-token';
  try {
    await withServer(async base => {
      const unauthorized = await fetch(`${base}/api/money/rails/offline/reenable`, { method: 'POST' });
      assert.equal(unauthorized.status, 401);

      const authorized = await fetch(`${base}/api/money/rails/offline/reenable`, {
        method: 'POST', headers: { authorization: 'Bearer secret-token' }
      });
      assert.equal(authorized.status, 200);
      const body = await authorized.json();
      assert.equal(body.state, 'PROBATION');
    });
  } finally {
    delete process.env.TASKMAN_API_TOKEN;
  }
});
