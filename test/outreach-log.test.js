import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTREACH_OUTCOME, logOutreachAttempt, updateOutreachOutcome,
  listOutreachAttempts, outreachSummary, resetOutreachLogForTesting
} from '../src/outreach-log.js';

/**
 * Until an attempt is recorded, "we tried and it failed" and "nobody tried" are
 * indistinguishable from inside this repository — and when those two cannot be
 * told apart the default is always to build, because building is the half that
 * can be observed. See docs/WHY-NO-MONEY-YET.md.
 */

const reset = () => resetOutreachLogForTesting();

test('records an attempt', async () => {
  reset();
  const a = await logOutreachAttempt({ lane: 'audit', channel: 'r/Fiverr', prospect: 'u/someone' });
  assert.equal(a.lane, 'audit');
  assert.equal(a.outcome, OUTREACH_OUTCOME.PENDING, 'a fresh attempt has no outcome yet');
  assert.ok(a.id);
  assert.equal((await listOutreachAttempts()).length, 1);
});

test('requires the three facts that make an attempt checkable', async () => {
  reset();
  await assert.rejects(() => logOutreachAttempt({ channel: 'c', prospect: 'p' }), /lane/i);
  await assert.rejects(() => logOutreachAttempt({ lane: 'l', prospect: 'p' }), /channel/i);
  await assert.rejects(() => logOutreachAttempt({ lane: 'l', channel: 'c' }), /prospect/i);
});

test('rejects an outcome the schema would not accept', async () => {
  reset();
  const a = await logOutreachAttempt({ lane: 'audit', channel: 'c', prospect: 'p' });
  await assert.rejects(() => updateOutreachOutcome(a.id, 'MAYBE'), /outcome/i);
});

test('an outcome can be recorded later, with the date it came', async () => {
  reset();
  const a = await logOutreachAttempt({ lane: 'audit', channel: 'c', prospect: 'p' });
  const updated = await updateOutreachOutcome(a.id, OUTREACH_OUTCOME.REPLIED, { now: () => '2026-09-20T00:00:00.000Z' });
  assert.equal(updated.outcome, 'REPLIED');
  assert.equal(updated.respondedAt, '2026-09-20T00:00:00.000Z');
});

test('the same prospect is not logged twice on the same channel', async () => {
  reset();
  await logOutreachAttempt({ lane: 'audit', channel: 'r/Fiverr', prospect: 'u/someone' });
  const second = await logOutreachAttempt({ lane: 'audit', channel: 'r/Fiverr', prospect: 'u/someone' });
  assert.equal(second.duplicate, true, 'contacting the same person twice is a fact worth knowing');
  assert.equal((await listOutreachAttempts()).length, 1);
});

test('a note is scrubbed of credentials before it is stored', async () => {
  reset();
  const a = await logOutreachAttempt({
    lane: 'audit', channel: 'c', prospect: 'p',
    note: 'they pasted ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 in the thread'
  });
  assert.ok(!a.note.includes('ghp_ABCDEF'), 'a free-text note is still permanent storage');
});

test('summary counts what the kill criteria need', async () => {
  reset();
  for (let i = 0; i < 5; i += 1) {
    await logOutreachAttempt({ lane: 'audit', channel: 'r/Fiverr', prospect: `u/p${i}` });
  }
  const s = await outreachSummary('audit');
  assert.equal(s.attempts, 5);
  assert.equal(s.replies, 0);
  assert.equal(s.paid, 0);
});

test('replies and paid are counted separately', async () => {
  reset();
  const a = await logOutreachAttempt({ lane: 'audit', channel: 'c', prospect: 'p1' });
  const b = await logOutreachAttempt({ lane: 'audit', channel: 'c', prospect: 'p2' });
  await updateOutreachOutcome(a.id, OUTREACH_OUTCOME.REPLIED);
  await updateOutreachOutcome(b.id, OUTREACH_OUTCOME.PAID);
  const s = await outreachSummary('audit');
  assert.equal(s.attempts, 2);
  assert.equal(s.replies, 2, 'a paid prospect necessarily replied');
  assert.equal(s.paid, 1);
});

test('a summary is scoped to its lane', async () => {
  reset();
  await logOutreachAttempt({ lane: 'audit', channel: 'c', prospect: 'p1' });
  await logOutreachAttempt({ lane: 'vibe-security', channel: 'c', prospect: 'p2' });
  assert.equal((await outreachSummary('audit')).attempts, 1);
});

test('the kill criterion does not fire early', async () => {
  reset();
  for (let i = 0; i < 49; i += 1) {
    await logOutreachAttempt({ lane: 'audit', channel: 'c', prospect: `p${i}` });
  }
  assert.equal((await outreachSummary('audit')).killCriterionReached, false);
});

test('the kill criterion fires at 50 attempts with zero paid', async () => {
  reset();
  for (let i = 0; i < 50; i += 1) {
    await logOutreachAttempt({ lane: 'audit', channel: 'c', prospect: `p${i}` });
  }
  const s = await outreachSummary('audit');
  assert.equal(s.killCriterionReached, true);
  assert.match(s.verdict, /50 attempts/);
});

test('one paid customer keeps the lane alive at any attempt count', async () => {
  reset();
  for (let i = 0; i < 60; i += 1) {
    await logOutreachAttempt({ lane: 'audit', channel: 'c', prospect: `p${i}` });
  }
  const all = await listOutreachAttempts();
  await updateOutreachOutcome(all[0].id, OUTREACH_OUTCOME.PAID);
  assert.equal((await outreachSummary('audit')).killCriterionReached, false);
});

test('an empty lane has not been tried — and says so, rather than reading as failed', async () => {
  reset();
  const s = await outreachSummary('audit');
  assert.equal(s.attempts, 0);
  assert.equal(s.killCriterionReached, false);
  assert.match(s.verdict, /not been tried|no attempts/i);
});
