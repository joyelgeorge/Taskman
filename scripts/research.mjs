#!/usr/bin/env node
/**
 * `npm run research` — record what a pass found, so the next session has it.
 *
 *   npm run research -- add "claim" --source "file:line or URL" [--lane <lane>]
 *   npm run research -- list [--lane <lane>]
 *   npm run research -- export          # writes the git-side mirror
 */
import { readFlag } from '../src/cli-flags.js';
import { writeFile } from 'node:fs/promises';
import { databaseEnabled } from '../src/db.js';
import {
  recordResearchNote, listResearchNotes, renderResearchMirror
} from '../src/research-log.js';

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name) => readFlag(argv ?? args, name);

const MIRROR = 'docs/research/NOTES.md';

if (command === 'add') {
  const claim = argv[1];
  if (!claim || claim.startsWith('--')) {
    console.error('usage: npm run research -- add "claim" --source "where it can be checked"');
    process.exit(2);
  }
  if (!databaseEnabled) {
    // Same refusal as the outreach log. A note written to a memory store that
    // dies with this process is the exact failure this table exists to end, and
    // pretending it was saved is worse than saying it was not.
    console.error('DATABASE_URL is not set. A note recorded in memory dies with this process,');
    console.error('which is the failure this log exists to prevent. Refusing to pretend.');
    process.exit(1);
  }
  const note = await recordResearchNote({ claim, source: flag('source'), lane: flag('lane') });
  console.log(`${note.tier}  ${note.claim}`);
  if (note.tier === 'HYPOTHESIS') {
    console.log('  (no source given — recorded as a hypothesis, not a finding)');
  }
  process.exit(0);
}

if (command === 'list' || command === 'export') {
  if (!databaseEnabled) {
    console.error('DATABASE_URL is not set — the note store cannot be read. This is UNKNOWN,');
    console.error('not empty. Run `npm run brief` for what this session can and cannot see.');
    process.exit(1);
  }
  const notes = await listResearchNotes({ lane: flag('lane') });
  if (command === 'export') {
    await writeFile(MIRROR, renderResearchMirror(notes));
    console.log(`wrote ${notes.length} note(s) to ${MIRROR}`);
  } else if (!notes.length) {
    console.log('No notes recorded. That is empty, not unknown — the store answered.');
  } else {
    for (const n of notes) console.log(`${n.recordedAt}  ${n.tier.padEnd(11)}${n.claim}`);
  }
  process.exit(0);
}

console.error('usage: npm run research -- <add|list|export>');
process.exit(2);
