import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  createDatabaseRuntimePolicy,
  poolSnapshot,
  safeDatabaseErrorCode
} from './db-runtime-policy.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'db', 'migrations');

export const databaseEnabled = Boolean(process.env.DATABASE_URL);
export const databaseRuntimePolicy = createDatabaseRuntimePolicy();
let lastPoolError = null;

export const pool = databaseEnabled
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'disable' ? false : undefined,
      max: databaseRuntimePolicy.poolMax,
      connectionTimeoutMillis: databaseRuntimePolicy.connectionTimeoutMs,
      idleTimeoutMillis: databaseRuntimePolicy.idleTimeoutMs,
      maxLifetimeSeconds: databaseRuntimePolicy.maxLifetimeSeconds,
      statement_timeout: databaseRuntimePolicy.statementTimeoutMs,
      query_timeout: databaseRuntimePolicy.queryTimeoutMs,
      lock_timeout: databaseRuntimePolicy.lockTimeoutMs,
      idle_in_transaction_session_timeout: databaseRuntimePolicy.idleTransactionTimeoutMs,
      application_name: 'taskman'
    })
  : null;

if (pool) {
  pool.on('error', error => {
    lastPoolError = {
      code: safeDatabaseErrorCode(error),
      occurredAt: new Date().toISOString()
    };
    console.error('[Taskman DB] idle client error', lastPoolError);
  });
}

export async function query(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  return pool.query(text, params);
}

export async function setTransactionBudgets(client, {
  statementTimeoutMs = databaseRuntimePolicy.statementTimeoutMs,
  lockTimeoutMs = databaseRuntimePolicy.lockTimeoutMs,
  idleTransactionTimeoutMs = databaseRuntimePolicy.idleTransactionTimeoutMs
} = {}) {
  await client.query(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);
  await client.query(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
  await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${idleTransactionTimeoutMs}ms'`);
}

export async function runTransaction(client, fn, budgets) {
  await client.query('BEGIN');
  try {
    await setTransactionBudgets(client, budgets);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      error.rollbackCode = safeDatabaseErrorCode(rollbackError);
    }
    throw error;
  }
}

export async function withTransaction(fn, budgets) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  const client = await pool.connect();
  try {
    return await runTransaction(client, fn, budgets);
  } finally {
    client.release();
  }
}

export async function migrate() {
  if (!pool) return { enabled: false, applied: [] };

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
  const applied = [];

  for (const filename of files) {
    const exists = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
    if (exists.rowCount) continue;

    const sql = await readFile(join(migrationsDir, filename), 'utf8');
    await withTransaction(async client => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
    }, {
      statementTimeoutMs: databaseRuntimePolicy.migrationStatementTimeoutMs,
      lockTimeoutMs: databaseRuntimePolicy.migrationLockTimeoutMs
    });
    applied.push(filename);
  }

  return { enabled: true, applied };
}

export async function healthCheck() {
  if (!pool) return { enabled: false, ok: false, reasonCode: 'DATABASE_DISABLED', pool: poolSnapshot(pool) };
  try {
    const result = await pool.query('SELECT now() AS now');
    return { enabled: true, ok: true, now: result.rows[0].now, pool: poolSnapshot(pool, lastPoolError) };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      reasonCode: safeDatabaseErrorCode(error),
      pool: poolSnapshot(pool, lastPoolError)
    };
  }
}
