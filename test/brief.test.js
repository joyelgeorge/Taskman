import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrief, renderBrief } from '../src/brief.js';

const ok = (label, rows) => ({ label, enabled: true, read: async () => rows });
const pg = (label) => ({ label, enabled: false, read: async () => [] });

test('a brief that could not reach a store renders UNKNOWN, never a number', async () => {
  const brief = await buildBrief({ readers: [pg('settlements')] });
  const text = renderBrief(brief);

  assert.match(text, /settlements\s+UNKNOWN/);
  // The bug in one assertion: a zero on this line is the thing being prevented.
  assert.doesNotMatch(text, /settlements\s+\S*\s*0\b/);
  assert.match(text, /not configured/);
});

test('a brief that reached a store holding nothing renders a zero it can stand behind', async () => {
  const brief = await buildBrief({ readers: [ok('settlements', [])] });
  const text = renderBrief(brief);

  assert.match(text, /settlements\s+empty\s+0/);
});

test('a brief that reached a store holding rows renders the count as verified', async () => {
  const brief = await buildBrief({ readers: [ok('leads', [{ id: 1 }, { id: 2 }, { id: 3 }])] });

  assert.match(renderBrief(brief), /leads\s+verified\s+3/);
});

test('a brief exits non-zero when any store could not answer', async () => {
  const complete = await buildBrief({ readers: [ok('leads', [])] });
  const incomplete = await buildBrief({ readers: [ok('leads', []), pg('settlements')] });

  assert.equal(complete.exitCode, 0);
  assert.equal(incomplete.exitCode, 1);
});

test('a brief says out loud that its position is incomplete', async () => {
  const incomplete = await buildBrief({ readers: [pg('settlements')] });

  assert.equal(incomplete.complete, false);
  assert.match(renderBrief(incomplete), /position is incomplete/i);
});
