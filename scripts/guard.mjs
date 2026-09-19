#!/usr/bin/env node
/**
 * `npm run guard` — the operator's position against their own failure modes.
 * `npm run guard -- lane <proposal.json>` — run a proposed lane through the
 * seven intake filters before it touches income_streams or docs/tasks.
 *
 * Exit codes for `lane`: 0 admit, 2 park, 1 reject or unreadable input, so a
 * script or a session can act on the verdict without parsing text.
 *
 * Research behind every filter: docs/OPERATOR-GUARDS.md.
 */
import { readFile } from 'node:fs/promises';
import { databaseEnabled, query } from '../src/db.js';
import { readStore, STORE_STATE } from '../src/store-state.js';
import {
  GUARD_VERDICT, DEFAULT_LIMITS, evaluateNewLane, humanStepDebt, laneLoad, commitmentStatus
} from '../src/operator-guards.js';

const COMMITMENT_PATH = 'data/operator-commitment.json';

async function loadCommitment() {
  try {
    return JSON.parse(await readFile(COMMITMENT_PATH, 'utf8'));
  } catch (error) {
    console.log(`  ${COMMITMENT_PATH} unreadable — ${error.message}. No commitment is being enforced.`);
    return null;
  }
}

const streamsRead = await readStore({
  label: 'income_streams',
  enabled: databaseEnabled,
  read: async () => (await query(
    'SELECT stream_key, title, state, unblocked_by, test_cost_hours, next_action, created_at, updated_at FROM income_streams'
  )).rows
});
const streams = streamsRead.rows ?? [];
const commitment = await loadCommitment();
const [command, arg] = process.argv.slice(2);

if (command === 'lane') {
  if (!arg) {
    console.log('usage: npm run guard -- lane <proposal.json>');
    process.exit(1);
  }
  let proposal;
  try {
    proposal = JSON.parse(await readFile(arg, 'utf8'));
  } catch (error) {
    console.log(`cannot read proposal ${arg}: ${error.message}`);
    process.exit(1);
  }
  if (streamsRead.state === STORE_STATE.UNKNOWN) {
    console.log('WARNING: income_streams is UNKNOWN. The WIP and human-step-debt filters ran against');
    console.log('         nothing and will look falsely clear. Do not act on an ADMIT from this run.\n');
  }
  const result = evaluateNewLane({ proposal, streams, commitment });
  console.log(`VERDICT: ${result.verdict.toUpperCase()}  (${proposal.title ?? proposal.stream_key ?? 'untitled'})\n`);
  for (const r of result.reasons) {
    console.log(`  [${r.verdict.padEnd(6)}] ${r.filter}: ${r.why}`);
  }
  if (result.verdict === GUARD_VERDICT.PARK) {
    console.log('\n  Parked: add one line to docs/operator/parking-lot.md. Revisit at the commitment review.');
  }
  process.exit(result.verdict === GUARD_VERDICT.ADMIT ? 0 : result.verdict === GUARD_VERDICT.PARK ? 2 : 1);
}

console.log('COMMITMENT');
const status = commitmentStatus({ commitment });
if (status.state === 'none' || status.state === 'invalid') {
  console.log(`  ${status.state.toUpperCase()}: ${status.problems.join('; ')}`);
} else {
  console.log(`  primary: ${status.primary} — ${status.state}, day ${status.daysElapsed}, ${status.daysRemaining} day(s) to review`);
  for (const k of status.overdueCriteria) console.log(`  OVERDUE ${k.date}: ${k.state}\n          if missed: ${k.ifMissed}`);
  for (const k of status.dueCriteria) console.log(`  due     ${k.date}: ${k.state}`);
}

console.log('\nHUMAN-STEP DEBT');
if (streamsRead.state === STORE_STATE.UNKNOWN) {
  console.log(`  UNKNOWN — ${streamsRead.reason}`);
} else {
  const all = humanStepDebt({ streams, commitment });
  const debt = all.filter(d => !d.outsideCommitment);
  const outside = all.filter(d => d.outsideCommitment);
  if (!debt.length) console.log('  none inside the commitment. Its own steps are the criteria listed above.');
  for (const d of debt) {
    const cost = d.costHours === null ? 'cost unknown' : `~${d.costHours}h`;
    const flag = d.overdue ? 'OVERDUE' : d.cheap ? 'cheap  ' : '       ';
    console.log(`  ${flag} ${d.title} (${cost}, waiting ${d.ageDays ?? '?'}d)`);
    if (d.overdue && d.next_action) console.log(`          next: ${d.next_action}`);
  }
  if (outside.length) {
    console.log(`\n  Waiting on the operator but OUTSIDE the commitment (${outside.length}) — park or disprove, do not do:`);
    for (const d of outside) console.log(`    ${d.stream_key}`);
  }
}

console.log('\nLANE LOAD');
if (streamsRead.state === STORE_STATE.UNKNOWN) {
  console.log('  UNKNOWN');
} else {
  const load = laneLoad({ streams });
  console.log(`  primary    ${load.primary.length}/${DEFAULT_LIMITS.maxPrimaryLanes}: ${load.primary.join(', ') || '—'}`);
  console.log(`  background ${load.background.length}/${DEFAULT_LIMITS.maxBackgroundLanes}: ${load.background.join(', ') || '—'}`);
  if (load.overPrimary || load.overBackground) {
    console.log('  Over the limit. Park or disprove lanes until each count is within it; every extra');
    console.log('  concurrent lane takes effort from all the others, not only from itself.');
  }
}
