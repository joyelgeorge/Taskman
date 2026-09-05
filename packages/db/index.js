import pg from 'pg';

const { Pool } = pg;

export const databaseEnabled = Boolean(process.env.DATABASE_URL);

const isLocal = url => /localhost|127\.0\.0\.1/.test(url || '');

export const pool = databaseEnabled
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      // Managed Postgres (Neon, Render, Supabase) requires TLS; local does not.
      ssl: process.env.PGSSL === 'disable' || isLocal(process.env.DATABASE_URL)
        ? false
        : { rejectUnauthorized: false },
      max: Number(process.env.PGPOOL_MAX || 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000
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

export async function healthCheck() {
  if (!pool) return { enabled: false, ok: false, reason: 'DATABASE_URL not set (memory mode)' };
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    return { enabled: true, ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { enabled: true, ok: false, latencyMs: Date.now() - started, reason: String(error.message || error) };
  }
}

export async function closePool() {
  if (pool) await pool.end();
}

/**
 * Empties the named tables so a test starts from the same blank slate the
 * in-memory path gets for free.
 *
 * Every store used to reset only its Map, which made each reset*Memory() a
 * silent no-op whenever DATABASE_URL was set. The suite therefore only ever
 * verified the memory path, while production runs the PostgreSQL one; rows
 * leaked between tests and 59 of them failed for that reason alone.
 *
 * Refuses to run unless NODE_ENV === 'test'. TRUNCATE against a real database
 * is unrecoverable, and this function exists solely to be called from tests.
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
