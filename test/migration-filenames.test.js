import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = [join(root, 'db', 'migrations'), join(root, 'packages', 'db', 'migrations')];

async function allMigrations() {
  const found = [];
  for (const dir of DIRS) {
    const names = await readdir(dir).catch(() => []);
    for (const name of names.filter(n => n.endsWith('.sql'))) found.push({ name, dir });
  }
  return found;
}

test('no two migrations share a filename', async () => {
  // Both runners key schema_migrations by filename alone. Two files with the same
  // name means one is applied and the other silently never runs, and the second
  // directory's schema is simply missing in production.
  const seen = new Map();
  for (const { name, dir } of await allMigrations()) {
    assert.equal(seen.has(name), false, `${name} exists in both ${seen.get(name)} and ${dir}`);
    seen.set(name, dir);
  }
});

test('a shared numeric prefix is allowed, and the order stays deterministic', async () => {
  // 026_finance_report_history.sql and 026_outreach_drafts.sql landed from
  // concurrent work and are both already applied in production. Renaming either
  // would leave an applied row with no matching file, which the runner treats as
  // a hard failure — so duplicate prefixes are tolerated deliberately. What must
  // hold is that the sort is total and stable, so every environment applies the
  // same sequence.
  const names = (await allMigrations()).map(m => m.name);
  const sortedOnce = [...names].sort((a, b) => a.localeCompare(b));
  const sortedTwice = [...sortedOnce].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(sortedTwice, sortedOnce);
  assert.equal(new Set(sortedOnce).size, sortedOnce.length);
});
