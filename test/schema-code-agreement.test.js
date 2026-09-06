import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseEnabled, query } from '../src/db.js';

import { STREAM_STATES, STREAM_ORIGINS } from '@taskman/core';
import { SETTLEMENT_STATUS, VERIFIED_SOURCES } from '../src/money-ledger.js';
import { LEAD_SOURCE, LEAD_STATUS } from '@taskman/core/marketing/store.js';
import { EXPENSE_CATEGORIES } from '@taskman/core';

/**
 * The values the code can write must be values the schema will accept.
 *
 * This has now been the cause of three separate production failures, each with
 * the same shape: memory mode enforces nothing, so a value the database forbids
 * passes every test and fails only where it matters.
 *
 *   outreach_drafts        written by code, created by no migration at all
 *   income_streams.origin  CHECK allowed two values, the console sent a third,
 *                          POST /api/money/opportunities returned 500
 *   observation_sources    kind 'rss' rejected until migration 027
 *
 * A grep cannot catch this and review evidently does not. So this reads the real
 * constraints out of a migrated database and asserts each code-side vocabulary is
 * a subset of what its column permits. It runs only with DATABASE_URL, which is
 * the only place the question is answerable.
 */

const dbOnly = { skip: databaseEnabled ? false : 'reads real constraints from PostgreSQL' };

/** The allowed values PostgreSQL will actually accept for a column. */
async function allowedValues(table, column) {
  const { rows } = await query(`
    SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = $1 AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%' || $2 || '%'
  `, [table, column]);
  const values = new Set();
  for (const row of rows) {
    for (const match of row.def.matchAll(/'([^']+)'/g)) values.add(match[1]);
  }
  return values;
}

const cases = [
  ['income_streams', 'state', Object.values(STREAM_STATES)],
  ['income_streams', 'origin', STREAM_ORIGINS],
  ['settlements', 'status', Object.values(SETTLEMENT_STATUS)],
  ['settlements', 'source', VERIFIED_SOURCES],
  ['leads', 'source', Object.values(LEAD_SOURCE)],
  ['leads', 'status', Object.values(LEAD_STATUS)],
  ['expenses', 'category', Object.values(EXPENSE_CATEGORIES)]
];

for (const [table, column, codeValues] of cases) {
  test(`${table}.${column} accepts every value the code can write`, dbOnly, async () => {
    const allowed = await allowedValues(table, column);
    if (allowed.size === 0) return; // no CHECK on this column; nothing to disagree with
    const rejected = codeValues.filter(v => !allowed.has(v));
    assert.deepEqual(rejected, [],
      `${table}.${column} would reject ${JSON.stringify(rejected)} — the code can produce these, `
      + `the schema permits only ${JSON.stringify([...allowed])}. Widen the constraint or stop `
      + 'producing the value; do not leave them disagreeing.');
  });
}

test('every table the code writes to actually exists', dbOnly, async () => {
  // outreach_drafts was written to for months and created by no migration. The
  // insert was wrapped in a catch that fell back to memory and returned ok:true,
  // so it reported success while discarding every row.
  const required = [
    'income_streams', 'data_products', 'settlements', 'rail_attempts', 'rail_state',
    'observation_sources', 'observations', 'observation_rollups', 'outreach_drafts',
    'leads', 'campaigns', 'expenses', 'cron_runs', 'cron_expectations', 'drones', 'signals'
  ];
  const { rows } = await query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  const present = new Set(rows.map(r => r.table_name));
  const missing = required.filter(t => !present.has(t));
  assert.deepEqual(missing, [], `missing tables: ${missing.join(', ')}`);
});
