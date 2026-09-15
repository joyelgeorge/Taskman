#!/usr/bin/env node
/**
 * `npm run brief` — the command a session runs first.
 *
 * Reconstructs the position from the stores that can answer, and labels every
 * row with which one did. Exits non-zero when any store could not be reached,
 * so an incomplete position cannot be read as a complete one.
 */
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { databaseEnabled, query } from '../src/db.js';
import { buildBrief, renderBrief } from '../src/brief.js';
import { EXPLORED_TERRITORIES, VERDICT } from '../packages/core/territory/registry.js';
import { readTasks, TASK_STATUS } from '../src/task-index.js';

const run = promisify(execFile);

const sql = (label, text) => ({
  label, enabled: databaseEnabled, read: async () => (await query(text)).rows
});

// Stores that are always readable: the filesystem and git travel with the repo,
// so these rows are never UNKNOWN and a session always has them.
const local = (label, read) => ({ label, enabled: true, read });

const readers = [
  sql('settlements', 'SELECT id, gross_cents, currency FROM settlements'),
  sql('settlements cleared', "SELECT id FROM settlements WHERE status = 'cleared'"),
  sql('outreach attempts', 'SELECT id, lane, outcome FROM outreach_attempts'),
  sql('leads', 'SELECT id FROM leads'),
  sql('scanned repos', 'SELECT repo FROM scanned_repos'),
  sql('research notes', 'SELECT id, tier FROM research_notes'),
  sql('job stage runs', 'SELECT id, outcome FROM job_runs'),

  local('open tasks', async () =>
    (await readTasks('docs/tasks')).filter(t => t.status !== TASK_STATUS.DONE)),
  local('tasks at level 1', async () =>
    (await readTasks('docs/tasks')).filter(t => t.valid && t.level === 1 && t.status === TASK_STATUS.OPEN)),
  local('migrations on disk', async () => [
    ...(await readdir('db/migrations')).filter(f => f.endsWith('.sql')),
    ...(await readdir('packages/db/migrations')).filter(f => f.endsWith('.sql'))
  ]),
  local('territories active', async () =>
    EXPLORED_TERRITORIES.filter(t => t.verdict === VERDICT.ACTIVE)),
  local('recent commits', async () =>
    (await run('git', ['log', '-5', '--format=%h %s'])).stdout.trim().split('\n'))
];

const brief = await buildBrief({ readers });
console.log(renderBrief(brief));

// The money line, spelled out rather than left to inference.
const settlements = brief.rows.find(r => r.label === 'settlements');
console.log('');
if (settlements.state === 'unknown') {
  console.log('Revenue: UNKNOWN. This session cannot see the ledger and must not');
  console.log('state a revenue figure, including zero.');
} else if (settlements.count === 0) {
  console.log('Revenue: zero, verified against the ledger. settlements is empty.');
} else {
  const total = settlements.rows.reduce((n, r) => n + Number(r.gross_cents || 0), 0);
  console.log(`Revenue: ${settlements.count} settlement(s), ${total} in minor units.`);
}

process.exit(brief.exitCode);
