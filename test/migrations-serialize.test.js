import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateChecksum, migrate, databaseEnabled, pool } from '../src/db.js';

test('Database Migrations: calculateChecksum generates deterministic sha256', () => {
  const content1 = 'CREATE TABLE test_table (id TEXT);';
  const content2 = 'CREATE TABLE test_table (id TEXT);';
  const content3 = 'CREATE TABLE test_table (id INT);';

  const hash1 = calculateChecksum(content1);
  const hash2 = calculateChecksum(content2);
  const hash3 = calculateChecksum(content3);

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);
  assert.equal(hash1.length, 64);
});

test('Database Migrations: migrate() runs safely in PostgreSQL mode with advisory locking', { skip: !databaseEnabled }, async () => {
  const res = await migrate();
  assert.equal(res.enabled, true);
  assert.ok(Array.isArray(res.applied));

  // Verify schema_migrations has checksums populated
  const rows = await pool.query('SELECT filename, checksum, applied_at FROM schema_migrations');
  assert.ok(rows.rows.length >= 1);
  for (const row of rows.rows) {
    assert.ok(row.checksum, `Migration ${row.filename} must have a non-empty checksum`);
    assert.equal(row.checksum.length, 64);
  }
});

test('Database Migrations: concurrent migrate() calls serialize cleanly', { skip: !databaseEnabled }, async () => {
  const [res1, res2] = await Promise.all([
    migrate(),
    migrate()
  ]);

  assert.equal(res1.enabled, true);
  assert.equal(res2.enabled, true);
});
