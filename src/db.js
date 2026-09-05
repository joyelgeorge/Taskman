import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { getRuntimeConfig } from './config.js';

const runtimeConfig = getRuntimeConfig();

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
// Both migration directories, in the same order packages/db/migrate.js uses.
// They share one schema_migrations table, so a runner that reads only db/migrations/
// sees the six packages/db rows as applied-but-missing and throws
// "Applied migration is missing from source: 007_drones_signals.sql" — which is
// exactly what a deploy hits after `npm run migrate:all`. Filenames are globally
// ordered across both directories, so the combined sequence is unambiguous.
const MIGRATION_DIRS = [
  join(__dirname, '..', 'db', 'migrations'),
  join(__dirname, '..', 'packages', 'db', 'migrations')
];

export const MIGRATION_ADVISORY_LOCK_ID = 847291048291;

export function calculateChecksum(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export const databaseEnabled = runtimeConfig.database.enabled;

export const pool = databaseEnabled
  ? new Pool({
      connectionString: runtimeConfig.database.url,
      ssl: runtimeConfig.database.ssl === 'disable' ? false : undefined,
      max: runtimeConfig.database.poolMax
    })
  : null;

export async function query(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loadMigrationsFromDisk() {
  const migrations = new Map();
  for (const dir of MIGRATION_DIRS) {
    let names = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const filename of names.filter(file => file.endsWith('.sql'))) {
      if (migrations.has(filename)) {
        throw new Error(`Duplicate migration filename across directories: ${filename}`);
      }
      const sql = await readFile(join(dir, filename), 'utf8');
      migrations.set(filename, { sql, checksum: calculateChecksum(sql) });
    }
  }
  return migrations;
}

/**
 * True when every migration on disk is already applied with a matching checksum,
 * so there is provably nothing to do.
 *
 * Every cron runs migrate() before its work, and GitHub delivers crons in bursts.
 * Taking the advisory lock unconditionally made them serialize behind each other,
 * and the loser died on `canceling statement due to statement timeout` after
 * waiting out the 15s lock timeout — a green cron turned red by a no-op.
 *
 * Migrations are pending only just after a deploy, so this lock-free check skips
 * the contention entirely in the normal case. It is only ever allowed to say
 * "nothing to do": anything else falls through to the locked path, which re-reads
 * under the lock and remains the authority on what gets applied.
 */
async function schemaIsCurrent(migrations) {
  let rows;
  try {
    const result = await query('SELECT filename, checksum FROM schema_migrations');
    rows = result.rows;
  } catch {
    return false; // no schema_migrations table yet, or unreadable — let the lock path decide
  }
  if (rows.length !== migrations.size) return false;
  for (const row of rows) {
    const migration = migrations.get(row.filename);
    if (!migration) return false;
    // A drifted checksum must reach the locked path so it throws the real error.
    if (row.checksum && row.checksum !== migration.checksum) return false;
    if (!row.checksum) return false; // needs the backfill the locked path performs
  }
  return true;
}

export async function migrate({ lockTimeoutMs = 15_000 } = {}) {
  if (!pool) return { enabled: false, applied: [] };
  const timeout = Number(lockTimeoutMs);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120_000) {
    throw new Error('Migration lock timeout must be an integer between 1 and 120000 milliseconds');
  }

  const preloaded = await loadMigrationsFromDisk();
  if (await schemaIsCurrent(preloaded)) return { enabled: true, applied: [], upToDate: true };

  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query("SELECT set_config('statement_timeout', $1, false)", [`${timeout}ms`]);
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
    lockAcquired = true;
    await client.query("SELECT set_config('statement_timeout', '0', false)");

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum TEXT,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');

    // Re-read under the lock: the authority on what is applied is always this
    // path, never the lock-free pre-check.
    const migrations = await loadMigrationsFromDisk();
    const filenames = [...migrations.keys()].sort();

    const existingResult = await client.query('SELECT filename, checksum FROM schema_migrations');
    const existing = new Map(existingResult.rows.map(row => [row.filename, row.checksum]));
    for (const [filename, storedChecksum] of existing) {
      const migration = migrations.get(filename);
      if (!migration) throw new Error(`Applied migration is missing from source: ${filename}`);
      if (storedChecksum && storedChecksum !== migration.checksum) {
        throw new Error(`Checksum drift detected for migration ${filename}; applied migrations are immutable`);
      }
      if (!storedChecksum) {
        await client.query(
          'UPDATE schema_migrations SET checksum=$1 WHERE filename=$2 AND checksum IS NULL',
          [migration.checksum, filename]
        );
      }
    }

    const applied = [];
    for (const filename of filenames) {
      if (existing.has(filename)) continue;
      const migration = migrations.get(filename);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations(filename, checksum) VALUES($1,$2)',
          [filename, migration.checksum]
        );
        await client.query('COMMIT');
        applied.push(filename);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return { enabled: true, applied };
  } finally {
    try {
      await client.query("SELECT set_config('statement_timeout', '0', false)");
      if (lockAcquired) await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
    } finally {
      client.release();
    }
  }
}

export async function healthCheck() {
  if (!pool) return { enabled: false, ok: false, reasonCode: 'DATABASE_NOT_CONFIGURED', retryable: false };
  try {
    const result = await pool.query('SELECT now() AS now');
    return { enabled: true, ok: true, now: result.rows[0].now };
  } catch {
    return { enabled: true, ok: false, reasonCode: 'DATABASE_UNAVAILABLE', retryable: true };
  }
}

/**
 * Test-only table reset for the legacy src/ client. Mirrors
 * packages/db/index.js's truncateForTesting; src/ and packages/ hold separate
 * pools, so each needs its own. See that copy for why this exists.
 */
export async function truncateForTesting(tables = []) {
  if (!databaseEnabled || tables.length === 0) return;
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'truncateForTesting refuses to run with NODE_ENV=' + (process.env.NODE_ENV || 'unset')
      + '. It empties real tables and is only ever safe from the test suite; set NODE_ENV=test.'
    );
  }
  await query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
