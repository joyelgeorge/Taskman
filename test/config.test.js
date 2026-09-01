import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { loadConfig, ConfigurationError } from '../src/config.js';

const validProduction = {
  NODE_ENV: 'production',
  TASKMAN_ROLE: 'preflight',
  PORT: '3000',
  DATABASE_URL: 'postgresql://db.example.test/taskman',
  TASKMAN_BASE_URL: 'https://taskman.example.test',
  TASKMAN_AUTH_MODE: 'api-key',
  TASKMAN_API_KEY: 'secret-sentinel',
  TASKMAN_TENANT_MODE: 'single-tenant'
};

test('development defaults are typed, safe, and immutable', () => {
  const config = loadConfig({});
  assert.equal(config.profile, 'development');
  assert.equal(config.port, 3000);
  assert.equal(config.database.enabled, false);
  assert.equal(config.scheduler.internalEnabled, false);
  assert.equal(config.rails.allowWrite, false);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.limits), true);
  assert.equal(config.safeSummary.persistence, 'memory');
});

test('production fails closed without durable storage, HTTPS, and authentication', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), error => {
    assert.equal(error instanceof ConfigurationError, true);
    assert.equal(error.code, 'TASKMAN_CONFIG_INVALID');
    assert.match(error.message, /DATABASE_URL is required/);
    assert.match(error.message, /TASKMAN_BASE_URL is required/);
    assert.match(error.message, /TASKMAN_AUTH_MODE is required/);
    assert.match(error.message, /TASKMAN_TENANT_MODE is required/);
    assert.match(error.message, /cannot be disabled in production/);
    return true;
  });
});

test('production values are parsed centrally for every process role', () => {
  for (const role of ['web', 'worker', 'migration', 'preflight']) {
    const config = loadConfig({
      ...validProduction,
      TASKMAN_ROLE: role,
      PORT: '8080',
      PGPOOL_MAX: '12',
      TASKMAN_INTERNAL_SCHEDULER_ENABLED: 'true',
      TASKMAN_BRAIN_INTERVAL_MINUTES: '5',
      TASKMAN_PROVIDER_TIMEOUT_MS: '30000'
    });
    assert.equal(config.role, role);
    assert.equal(config.port, 8080);
    assert.equal(config.database.poolMax, 12);
    assert.equal(config.scheduler.internalEnabled, true);
    assert.equal(config.scheduler.brainIntervalMinutes, 5);
    assert.equal(config.limits.providerTimeoutMs, 30000);
  }
});

test('write rails require an explicit allowlist and never become enabled by credentials alone', () => {
  const credentialOnly = loadConfig({
    ...validProduction,
    MOLTJOBS_API_KEY: 'rail-secret'
  });
  assert.equal(credentialOnly.rails.allowWrite, false);
  assert.deepEqual(credentialOnly.rails.writeEnabled, []);

  assert.throws(() => loadConfig({
    ...validProduction,
    TASKMAN_ALLOW_WRITE_RAILS: 'true'
  }), /TASKMAN_WRITE_RAILS must explicitly list enabled rails/);

  const enabled = loadConfig({
    ...validProduction,
    TASKMAN_ALLOW_WRITE_RAILS: 'true',
    TASKMAN_WRITE_RAILS: 'ugig,moltjobs,ugig'
  });
  assert.deepEqual(enabled.rails.writeEnabled, ['moltjobs', 'ugig']);
});

test('safe summaries exclude secrets and remain stable when only secrets rotate', () => {
  const first = loadConfig({
    ...validProduction,
    GEMINI_API_KEY: 'provider-secret-one',
    MOLTJOBS_API_KEY: 'rail-secret-one'
  });
  const second = loadConfig({
    ...validProduction,
    TASKMAN_API_KEY: 'secret-sentinel-rotated',
    GEMINI_API_KEY: 'provider-secret-two',
    MOLTJOBS_API_KEY: 'rail-secret-two'
  });
  const serialized = JSON.stringify(first.safeSummary);
  for (const secret of ['secret-sentinel', 'provider-secret-one', 'rail-secret-one', validProduction.DATABASE_URL]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.deepEqual(first.safeSummary, second.safeSummary);
  assert.match(first.safeSummary.fingerprint, /^[a-f0-9]{16}$/);
});

test('preflight validates configuration without opening external connections', () => {
  const success = spawnSync(process.execPath, ['scripts/preflight.js'], {
    cwd: process.cwd(),
    env: { ...process.env, ...validProduction },
    encoding: 'utf8'
  });
  assert.equal(success.status, 0, success.stderr);
  assert.equal(JSON.parse(success.stdout).ok, true);
  assert.equal(success.stdout.includes(validProduction.DATABASE_URL), false);
  assert.equal(success.stdout.includes(validProduction.TASKMAN_API_KEY), false);

  const failure = spawnSync(process.execPath, ['scripts/preflight.js'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', TASKMAN_ROLE: 'preflight', DATABASE_URL: '', TASKMAN_BASE_URL: '' },
    encoding: 'utf8'
  });
  assert.equal(failure.status, 1);
  const failureBody = JSON.parse(failure.stderr);
  assert.equal(failureBody.ok, false);
  assert.equal(failureBody.code, 'TASKMAN_CONFIG_INVALID');
  assert.equal(failureBody.problems.includes('DATABASE_URL is required'), true);
});

test('web, worker, and migration entry points reject invalid production before work starts', () => {
  const entryPoints = [
    { role: 'web', args: ['src/server.js'] },
    { role: 'worker', args: ['src/worker.js', 'discover'] },
    { role: 'migration', args: ['scripts/migrate.js'] }
  ];

  for (const entryPoint of entryPoints) {
    const result = spawnSync(process.execPath, entryPoint.args, {
      cwd: process.cwd(),
      env: { NODE_ENV: 'production', TASKMAN_ROLE: entryPoint.role },
      encoding: 'utf8',
      timeout: 2_000
    });
    assert.notEqual(result.status, 0, `${entryPoint.role} unexpectedly started`);
    assert.equal(result.signal, null, `${entryPoint.role} reached the timeout instead of failing fast`);
    assert.match(result.stderr, /TASKMAN_CONFIG_INVALID|Invalid Taskman configuration/);
    assert.equal(result.stdout.includes('Taskman running'), false);
    assert.equal(result.stdout.includes('Running stage'), false);
  }
});
