const DEFINITIONS = Object.freeze({
  poolMax: ['PGPOOL_MAX', 5, 1, 50],
  connectionTimeoutMs: ['PG_CONNECTION_TIMEOUT_MS', 5_000, 250, 60_000],
  idleTimeoutMs: ['PG_IDLE_TIMEOUT_MS', 30_000, 1_000, 600_000],
  maxLifetimeSeconds: ['PG_POOL_MAX_LIFETIME_SECONDS', 300, 30, 3_600],
  statementTimeoutMs: ['PG_STATEMENT_TIMEOUT_MS', 30_000, 1_000, 300_000],
  queryTimeoutMs: ['PG_QUERY_TIMEOUT_MS', 35_000, 1_000, 310_000],
  lockTimeoutMs: ['PG_LOCK_TIMEOUT_MS', 5_000, 100, 60_000],
  idleTransactionTimeoutMs: ['PG_IDLE_TRANSACTION_TIMEOUT_MS', 30_000, 1_000, 300_000],
  migrationStatementTimeoutMs: ['PG_MIGRATION_STATEMENT_TIMEOUT_MS', 300_000, 10_000, 1_800_000],
  migrationLockTimeoutMs: ['PG_MIGRATION_LOCK_TIMEOUT_MS', 30_000, 1_000, 300_000]
});

export function parseBoundedInteger(name, rawValue, { defaultValue, min, max }) {
  const value = rawValue === undefined || rawValue === '' ? defaultValue : Number(rawValue);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    const error = new Error(`${name} must be an integer between ${min} and ${max}`);
    error.code = 'INVALID_DATABASE_RUNTIME_CONFIG';
    throw error;
  }
  return value;
}

export function createDatabaseRuntimePolicy(env = process.env) {
  const policy = {};
  for (const [key, [name, defaultValue, min, max]] of Object.entries(DEFINITIONS)) {
    policy[key] = parseBoundedInteger(name, env[name], { defaultValue, min, max });
  }
  if (policy.queryTimeoutMs < policy.statementTimeoutMs) {
    const error = new Error('PG_QUERY_TIMEOUT_MS must be greater than or equal to PG_STATEMENT_TIMEOUT_MS');
    error.code = 'INVALID_DATABASE_RUNTIME_CONFIG';
    throw error;
  }
  return Object.freeze(policy);
}

export function safeDatabaseErrorCode(error) {
  const candidate = typeof error?.code === 'string' ? error.code : '';
  if (/^[A-Z0-9_]{2,32}$/.test(candidate)) return candidate;
  return 'DATABASE_UNAVAILABLE';
}

export function poolSnapshot(pool, lastPoolError = null) {
  if (!pool) return { total: 0, idle: 0, waiting: 0, lastError: lastPoolError };
  return {
    total: Number(pool.totalCount || 0),
    idle: Number(pool.idleCount || 0),
    waiting: Number(pool.waitingCount || 0),
    lastError: lastPoolError
  };
}
