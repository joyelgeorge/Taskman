import test from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE_TIER } from '../src/evidence-tier.js';
import {
  recordResearchNote, listResearchNotes, renderResearchMirror, resetResearchLogForTesting
} from '../src/research-log.js';

test.beforeEach(async () => resetResearchLogForTesting());

test('a note with a checkable source is REFERENCED', async () => {
  const note = await recordResearchNote({
    claim: 'flyrpro exposes a service_role key',
    source: 'scripts/stamp-addresses-with-gers.ts:70, read from a fresh clone'
  });

  assert.equal(note.tier, EVIDENCE_TIER.REFERENCED);
  assert.equal(note.claim, 'flyrpro exposes a service_role key');
});

test('a note with no source is recorded as a HYPOTHESIS rather than refused', async () => {
  const note = await recordResearchNote({ claim: 'small retailers probably lose money to duplicate invoices' });

  assert.equal(note.tier, EVIDENCE_TIER.HYPOTHESIS);
  assert.equal(note.source, null);
});

test('a claim cannot be recorded as CONFIRMED without a source', async () => {
  await assert.rejects(
    () => recordResearchNote({ claim: 'the lane converts', tier: EVIDENCE_TIER.CONFIRMED }),
    /source/i
  );
});

test('a note refuses to be recorded without a claim', async () => {
  await assert.rejects(() => recordResearchNote({ source: 'somewhere' }), /claim/i);
});

test('secrets in a claim or source are scrubbed before they are stored', async () => {
  const note = await recordResearchNote({
    claim: 'their config read PASSWORD=hunter2supersecret in the bundle',
    source: 'bundle.js:1'
  });

  assert.doesNotMatch(note.claim, /hunter2supersecret/);
});

test('notes are listed newest first', async () => {
  await recordResearchNote({ claim: 'first', source: 'a' });
  await recordResearchNote({ claim: 'second', source: 'b' });

  const notes = await listResearchNotes();
  assert.equal(notes.length, 2);
  assert.equal(notes[0].claim, 'second');
});

test('the mirror renders a note with its tier and source so git holds the evidence', async () => {
  await recordResearchNote({ claim: 'flyrpro has 1 exposed secret, not 71', source: 'codebase-audit run' });

  const md = renderResearchMirror(await listResearchNotes());
  assert.match(md, /flyrpro has 1 exposed secret, not 71/);
  assert.match(md, /REFERENCED/);
  assert.match(md, /codebase-audit run/);
});
