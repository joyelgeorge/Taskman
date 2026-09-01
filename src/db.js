import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { getRuntimeConfig } from './config.js';

const runtimeConfig = getRuntimeConfig();

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'db', 'migrations');

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
    });
    applied.push(filename);
  }

  return { enabled: true, applied };
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
