import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { calculateChecksum, databaseEnabled, migrate, pool } from '../src/db.js';

test('migration checksums are deterministic SHA-256 values', () => {
  const first = calculateChecksum('CREATE TABLE fixture (id TEXT);');
  const same = calculateChecksum('CREATE TABLE fixture (id TEXT);');
  const changed = calculateChecksum('CREATE TABLE fixture (id UUID);');
  assert.equal(first, same);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('migration lock timeout is strictly bounded', async () => {
  if (!databaseEnabled) {
    assert.deepEqual(await migrate({ lockTimeoutMs: 0 }), { enabled: false, applied: [] });
    return;
  }
  await assert.rejects(() => migrate({ lockTimeoutMs: 0 }), /between 1 and 120000/);
});

test('migrations persist checksums and remain idempotent', { skip: !databaseEnabled }, async () => {
  const result = await migrate();
  assert.equal(result.enabled, true);
  const rows = await pool.query('SELECT filename, checksum FROM schema_migrations ORDER BY filename');
  assert.ok(rows.rowCount > 0);
  for (const row of rows.rows) assert.match(row.checksum, /^[a-f0-9]{64}$/);
  assert.deepEqual((await migrate()).applied, []);
});

test('concurrent migration runners serialize cleanly', { skip: !databaseEnabled }, async () => {
  const results = await Promise.all([migrate(), migrate(), migrate()]);
  assert.ok(results.every(result => result.enabled));
  assert.ok(results.every(result => result.applied.length === 0));
});

test('checksum drift fails closed without applying work', { skip: !databaseEnabled }, async () => {
  const row = (await pool.query(
    'SELECT filename, checksum FROM schema_migrations ORDER BY filename LIMIT 1'
  )).rows[0];
  assert.ok(row);
  await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE filename=$2', ['0'.repeat(64), row.filename]);
  try {
    await assert.rejects(() => migrate(), new RegExp(`Checksum drift detected for migration ${row.filename}`));
  } finally {
    const sql = await readFile(join('db', 'migrations', row.filename), 'utf8');
    await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE filename=$2', [calculateChecksum(sql), row.filename]);
  }
});
