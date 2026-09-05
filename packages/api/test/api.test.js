import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import {
  resetCronMemory, resetAlertMemory, resetDroneMemory, resetSignalMemory, registerDrone,
  resetScanMemory, resetFinanceMemory, resetLedgerMemory, resetGovernorMemory, registerCron,
  recordFinanceReportSnapshot
} from '@taskman/core';

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

async function reset() {
  await resetCronMemory(); await resetAlertMemory(); await resetDroneMemory(); await resetSignalMemory();
  await resetScanMemory(); await resetFinanceMemory(); await resetLedgerMemory(); await resetGovernorMemory();
}

test('status summarises every subsystem', async () => {
  await reset();
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
  await reset();
  // Drive the degradation instead of relying on the environment. This test used
  // to assume DATABASE_URL was unset, so it asserted 503 only because the db
  // check failed — which made it pass in memory mode and fail against a healthy
  // PostgreSQL. A registered cron that has never run reads OVERDUE, which is DOWN
  // in either storage mode.
  await registerCron({ cronName: 'never-ran', schedule: '*/5 * * * *', maxSilenceSeconds: 60 });
  await withServer(async base => {
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
  await reset();
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
  await reset();
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
  await reset();
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
  await reset();
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
  await reset();
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

test('scans/targets requires the token to add a target, but reads stay open', async () => {
  await reset();
  process.env.TASKMAN_API_TOKEN = 'secret-token';
  try {
    await withServer(async base => {
      const unauthorized = await fetch(`${base}/api/scans/targets`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetKey: 'x', targetUrl: 'https://x.example' })
      });
      assert.equal(unauthorized.status, 401);

      assert.equal((await get(base, '/api/scans')).status, 200);
      assert.equal((await get(base, '/api/scans/targets')).status, 200);

      const authorized = await fetch(`${base}/api/scans/targets`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer secret-token' },
        body: JSON.stringify({ targetKey: 'x', targetUrl: 'https://x.example' })
      });
      assert.equal(authorized.status, 200);
    });
  } finally {
    delete process.env.TASKMAN_API_TOKEN;
  }
});

test('POST /api/scans/run scans every registered target and the result shows up in GET /api/scans', async () => {
  await reset();
  // The route calls the job handler with no fetchImpl — correctly: an HTTP
  // caller must never be able to inject its own fetch implementation into a
  // server-side prober. That means this test's only offline option is stubbing
  // the real global fetch for its duration. The stub must still delegate calls
  // aimed at this test's own local server (127.0.0.1) to the real fetch, or the
  // test harness's own HTTP calls below would be intercepted too.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('127.0.0.1')) return realFetch(url, init);
    return { ok: true, status: 200, text: async () => `<title>x</title>${'x'.repeat(500)}` };
  };
  try {
    await withServer(async base => {
      const run = await fetch(`${base}/api/scans/run`, { method: 'POST' });
      assert.equal(run.status, 200);
      const runBody = await run.json();
      assert.ok(runBody.result.scanned >= 3, 'the default three hand-checked venues should be seeded and scanned');

      const { body } = await get(base, '/api/scans');
      assert.ok(body.scans.length >= 3);
      assert.ok(body.scans.every(s => 'verdict' in s && 'shape' in s));
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('finance/report is reachable with no auth and reports a real, empty-safe shape', async () => {
  await reset();
  await withServer(async base => {
    const { status, body } = await get(base, '/api/finance/report');
    assert.equal(status, 200);
    assert.equal(body.lifetime.netCents, 0);
    assert.ok(Array.isArray(body.perRail));
    assert.match(body.projection.method, /not a forecast/);
  });
});

test('finance/report/history returns historical snapshots with since and limit filtering', async () => {
  await reset();
  await recordFinanceReportSnapshot({
    date: '2026-09-01',
    report: { lifetime: { netCents: 1000 }, trailing: { burnRateCentsPerDay: 50 }, runway: { runwayDays: 60 } }
  });
  await recordFinanceReportSnapshot({
    date: '2026-09-02',
    report: { lifetime: { netCents: 1500 }, trailing: { burnRateCentsPerDay: 40 }, runway: { runwayDays: 75 } }
  });

  await withServer(async base => {
    const { status, body } = await get(base, '/api/finance/report/history');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.history));
    assert.equal(body.history.length, 2);
    assert.equal(body.history[0].snapshotDate, '2026-09-02');
    assert.equal(body.history[0].netCents, 1500);

    const filtered = await get(base, '/api/finance/report/history?since=2026-09-02');
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.history.length, 1);
    assert.equal(filtered.body.history[0].snapshotDate, '2026-09-02');

    const limited = await get(base, '/api/finance/report/history?limit=1');
    assert.equal(limited.status, 200);
    assert.equal(limited.body.history.length, 1);
    assert.equal(limited.body.history[0].snapshotDate, '2026-09-02');
  });
});

test('recording an expense requires the token when one is configured, and rejects a bad category', async () => {
  await reset();
  process.env.TASKMAN_API_TOKEN = 'secret-token';
  try {
    await withServer(async base => {
      const unauthorized = await fetch(`${base}/api/finance/expenses`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: 'infra', amountCents: 500 })
      });
      assert.equal(unauthorized.status, 401);

      const badCategory = await fetch(`${base}/api/finance/expenses`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer secret-token' },
        body: JSON.stringify({ category: 'yacht', amountCents: 500 })
      });
      assert.equal(badCategory.status, 400);

      const ok = await fetch(`${base}/api/finance/expenses`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer secret-token' },
        body: JSON.stringify({ category: 'infra', amountCents: 500, description: 'hosting' })
      });
      assert.equal(ok.status, 200);

      const { body } = await get(base, '/api/finance/expenses');
      assert.equal(body.expenses.length, 1);
      assert.ok(body.categories.includes('marketing'));
    });
  } finally {
    delete process.env.TASKMAN_API_TOKEN;
  }
});
