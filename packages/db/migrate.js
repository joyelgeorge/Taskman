#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseEnabled, pool, withTransaction } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

// Two migration directories: the original engine's, and this package's.
// Filenames are globally ordered, so the sequence is unambiguous across both.
const MIGRATION_DIRS = [join(repoRoot, 'db', 'migrations'), join(here, 'migrations')];

export async function collectMigrations() {
  const found = [];
  for (const dir of MIGRATION_DIRS) {
    let names = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names.filter(n => n.endsWith('.sql'))) {
      found.push({ filename: name, path: join(dir, name) });
    }
  }
  const seen = new Set();
  for (const m of found) {
    if (seen.has(m.filename)) throw new Error(`duplicate migration filename across directories: ${m.filename}`);
    seen.add(m.filename);
  }
  return found.sort((a, b) => a.filename.localeCompare(b.filename));
}

export async function migrate() {
  if (!databaseEnabled) return { enabled: false, applied: [] };

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrations = await collectMigrations();
  const applied = [];

  for (const migration of migrations) {
    const exists = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [migration.filename]);
    if (exists.rowCount) continue;

    const sql = await readFile(migration.path, 'utf8');
    await withTransaction(async client => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [migration.filename]);
    });
    applied.push(migration.filename);
  }

  return { enabled: true, applied, total: migrations.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(result => {
      if (!result.enabled) {
        console.error('DATABASE_URL is not set — nothing to migrate.');
        process.exit(1);
      }
      console.log(result.applied.length
        ? `Applied ${result.applied.length} migration(s):\n  ${result.applied.join('\n  ')}`
        : `Schema up to date (${result.total} migrations).`);
      return pool.end();
    })
    .catch(error => { console.error(error); process.exit(1); });
}
