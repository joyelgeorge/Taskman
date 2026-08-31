import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateHealth } from '../src/health.js';

const readyProvider = [{ id: 'openai', ready: true }];

test('production is unready when PostgreSQL is absent', () => {
  const health = evaluateHealth({
    database: { enabled: false, ok: false, reason: 'not configured' },
    providers: readyProvider,
    env: { NODE_ENV: 'production' }
  });

  assert.equal(health.status, 'unready');
  assert.equal(health.ready, false);
  assert.equal(health.mode, 'memory');
  assert.equal(health.components.database.status, 'unready');
  assert.equal(JSON.stringify(health).includes('not configured'), false);
});

test('production is unready when configured PostgreSQL is unhealthy', () => {
  const health = evaluateHealth({
    database: { enabled: true, ok: false, reason: 'connection failed' },
    providers: readyProvider,
    env: { NODE_ENV: 'production' }
  });

  assert.equal(health.ready, false);
  assert.equal(health.components.database.enabled, true);
});

test('local memory mode is ready but explicitly degraded and non-durable', () => {
  const health = evaluateHealth({
    database: { enabled: false, ok: false },
    providers: [],
    env: { NODE_ENV: 'development' }
  });

  assert.equal(health.status, 'degraded');
  assert.equal(health.ready, true);
  assert.equal(health.durable, false);
  assert.equal(health.components.providers.status, 'optional');
});

test('healthy PostgreSQL production mode is ready', () => {
  const health = evaluateHealth({
    database: { enabled: true, ok: true },
    providers: readyProvider,
    schedulerDurable: true,
    internalSchedulerEnabled: true,
    env: { NODE_ENV: 'production' }
  });

  assert.equal(health.status, 'healthy');
  assert.equal(health.ready, true);
  assert.equal(health.durable, true);
  assert.equal(health.components.scheduler.status, 'ready');
});

test('enabled internal scheduler must be durable', () => {
  const health = evaluateHealth({
    database: { enabled: true, ok: true },
    providers: readyProvider,
    schedulerDurable: false,
    internalSchedulerEnabled: true,
    env: { NODE_ENV: 'production' }
  });

  assert.equal(health.ready, false);
  assert.equal(health.components.scheduler.status, 'unready');
});

test('provider requirement is opt-in and fails closed', () => {
  const health = evaluateHealth({
    database: { enabled: true, ok: true },
    providers: [],
    env: { NODE_ENV: 'production', TASKMAN_REQUIRE_PROVIDER: 'true' }
  });

  assert.equal(health.ready, false);
  assert.equal(health.components.providers.status, 'unready');
});
