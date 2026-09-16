#!/usr/bin/env node
/**
 * `npm run next` — assemble the facts a next-step decision needs.
 *
 * It does not decide. It prints what is true, labelled `verified`, `empty` or
 * `UNKNOWN`, so the decision is made against the stores rather than against
 * whatever the last session remembers. See .claude/skills/deciding-the-next-step.
 */
import { readFile } from 'node:fs/promises';
import { databaseEnabled, query } from '../src/db.js';
import { readStore, STORE_STATE } from '../src/store-state.js';
import { readTasks, TASK_STATUS } from '../src/task-index.js';
import { commitmentStatus, laneLoad, DEFAULT_LIMITS } from '../src/operator-guards.js';

const sql = (label, text) => readStore({ label, enabled: databaseEnabled, read: async () => (await query(text)).rows });
const DAY = 86_400_000;

const settlements = await sql('settlements', 'SELECT id, gross_cents, currency FROM settlements');
const attempts = await sql('attempts', 'SELECT lane, outcome, attempted_at FROM outreach_attempts');
const streams = await sql('income_streams', 'SELECT stream_key, state, unblocked_by FROM income_streams');
const tasks = await readTasks('docs/tasks');
const commitment = await readFile('data/operator-commitment.json', 'utf8').then(JSON.parse).catch(() => null);

console.log('MONEY');
if (settlements.state === STORE_STATE.UNKNOWN) {
  console.log('  UNKNOWN — the ledger is unreachable. Do not state a revenue figure, including zero.');
} else {
  console.log(`  settlements: ${settlements.count} (${settlements.state})`);
}

console.log('\nOPERATOR COMMITMENT (docs/OPERATOR-GUARDS.md)');
const status = commitmentStatus({ commitment });
if (status.state === 'none' || status.state === 'invalid') {
  console.log(`  ${status.state.toUpperCase()} — ${status.problems.join('; ')}. New lanes are not being filtered.`);
} else {
  console.log(`  ${status.primary}: ${status.state}, ${status.daysRemaining} day(s) to review`);
  for (const k of status.overdueCriteria) {
    console.log(`  OVERDUE ${k.date}: ${k.state}`);
    console.log(`    -> ${k.ifMissed}`);
  }
  for (const k of status.dueCriteria) console.log(`  due ${k.date}: ${k.state}`);
  if (streams.state !== STORE_STATE.UNKNOWN) {
    const load = laneLoad({ streams: streams.rows ?? [] });
    if (load.overPrimary || load.overBackground) {
      console.log(`  lane load ${load.primary.length}/${DEFAULT_LIMITS.maxPrimaryLanes} primary, `
        + `${load.background.length}/${DEFAULT_LIMITS.maxBackgroundLanes} background — over the limit; \`npm run guard\` lists them`);
    }
  }
  console.log('  A new lane idea goes through `npm run guard -- lane <file>` before any build work.');
}

console.log('\nIN FLIGHT');
if (attempts.state === STORE_STATE.UNKNOWN) {
  console.log('  UNKNOWN — the attempt log is unreachable.');
} else if (attempts.count === 0) {
  console.log('  Nothing has been sent. This lane has NOT been tried, which is not the same as failed.');
} else {
  const byLane = {};
  for (const a of attempts.rows) {
    const l = (byLane[a.lane] ||= { n: 0, replies: 0, last: 0 });
    l.n += 1;
    if (a.outcome && a.outcome !== 'PENDING') l.replies += 1;
    l.last = Math.max(l.last, new Date(a.attempted_at).getTime());
  }
  for (const [lane, l] of Object.entries(byLane)) {
    const days = Math.floor((Date.now() - l.last) / DAY);
    console.log(`  ${lane}: ${l.n} attempt(s), ${l.replies} answered, last ${days}d ago`);
    if (l.replies === 0 && days < 7) {
      console.log(`    -> WAITING. Too early to follow up or to conclude anything. ${7 - days}d to go.`);
    } else if (l.replies === 0 && days >= 7 && l.n < 50) {
      console.log('    -> One follow-up is due. One. Then mark NO_RESPONSE.');
    }
  }
}

console.log('\nOPEN WORK, by what it actually produces');
const open = tasks.filter(t => t.valid && t.status !== TASK_STATUS.DONE);
const LEVEL = {
  1: 'a settlement row', 2: 'a named human who has seen the offer',
  3: 'a lead with a confirmed finding', 4: 'capability (maintenance — label it)'
};
for (const lvl of [1, 2, 3, 4]) {
  const at = open.filter(t => t.level === lvl);
  if (!at.length) continue;
  console.log(`  level ${lvl} — ${LEVEL[lvl]}: ${at.length}`);
  for (const t of at) console.log(`      [${t.priority}] ${t.status === 'blocked' ? 'BLOCKED ' : ''}${t.title}`);
}

const level1 = open.filter(t => t.level === 1);
console.log('\nTHE TEST');
console.log('  Which settlement row does the next action produce, and who pays it?');
if (!level1.length) {
  console.log('  No open task targets a settlement row. If the answer to the question above');
  console.log('  is "none directly, but it enables...", you are about to build supply again.');
} else {
  console.log(`  ${level1.length} open task(s) target one. Everything else is maintenance.`);
}
