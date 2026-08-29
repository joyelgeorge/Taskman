import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'db', 'migrations');

export const databaseEnabled = Boolean(process.env.DATABASE_URL);

export const pool = databaseEnabled
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'disable' ? false : undefined,
      max: Number(process.env.PGPOOL_MAX || 5)
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

import { createHash } from 'node:crypto';

export const MIGRATION_ADVISORY_LOCK_ID = 847291048291; // Deterministic 64-bit integer advisory lock key

export function calculateChecksum(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export async function migrate({ lockTimeoutMs = 15000 } = {}) {
  if (!pool) return { enabled: false, applied: [] };

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    // 1. Acquire transactional / session advisory lock to serialize multi-runner migrations
    await client.query(`SET statement_timeout = ${Number(lockTimeoutMs)}`);
    const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [MIGRATION_ADVISORY_LOCK_ID]);
    lockAcquired = Boolean(lockRes.rows[0]?.locked);

    if (!lockAcquired) {
      // Wait boundedly for advisory lock
      const waitRes = await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
      lockAcquired = true;
    }
    await client.query('SET statement_timeout = 0');

    // 2. Ensure schema_migrations table exists with checksum support
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum TEXT,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Backfill column if table already existed without checksum
    await client.query(`
      ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT
    `);

    const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
    const applied = [];

    // 3. Load all applied migration records
    const existingRes = await client.query('SELECT filename, checksum FROM schema_migrations');
    const existingMap = new Map(existingRes.rows.map(r => [r.filename, r.checksum]));

    for (const filename of files) {
      const filePath = join(migrationsDir, filename);
      const sql = await readFile(filePath, 'utf8');
      const currentChecksum = calculateChecksum(sql);

      if (existingMap.has(filename)) {
        const storedChecksum = existingMap.get(filename);
        if (storedChecksum && storedChecksum !== currentChecksum) {
          throw new Error(`Checksum drift detected for migration ${filename}: expected ${storedChecksum}, got ${currentChecksum}. Applied migrations are immutable.`);
        }
        // If checksum was null (legacy pre-checksum row), backfill it safely
        if (!storedChecksum) {
          await client.query('UPDATE schema_migrations SET checksum = $1 WHERE filename = $2', [currentChecksum, filename]);
        }
        continue;
      }

      // Apply new migration inside a transaction
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum, applied_at) VALUES ($1, $2, now())',
          [filename, currentChecksum]
        );
        await client.query('COMMIT');
        applied.push(filename);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${filename} failed: ${err.message}`);
      }
    }

    return { enabled: true, applied };
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
      } catch {}
    }
    client.release();
  }
}

export async function healthCheck() {
  if (!pool) return { enabled: false, ok: false, reason: 'DATABASE_URL not configured' };
  try {
    const result = await pool.query('SELECT now() AS now');
    return { enabled: true, ok: true, now: result.rows[0].now };
  } catch (error) {
    return { enabled: true, ok: false, reason: String(error.message || error) };
  }
}
