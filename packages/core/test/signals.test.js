import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSignal, processSignals } from '../signals/processor.js';
import { insertSignals, resetSignalMemory, listSignals, signalStats } from '../signals/store.js';
import { registerDrone, resetDroneMemory } from '../drones/store.js';

const fresh = () => new Date().toISOString();
function reset() { resetSignalMemory(); resetDroneMemory(); }

test('an excluded term rejects a signal outright', () => {
  const verdict = scoreSignal({ title: 'Ask HN: what editor', observedAt: fresh() }, { exclude: ['ask hn'] });
  assert.equal(verdict.passed, false);
  assert.match(verdict.reason, /excluded term/);
});

test('a signal matching no required term is rejected', () => {
  const verdict = scoreSignal({ title: 'Unrelated news', observedAt: fresh() }, { include: ['hiring', 'funding'] });
  assert.equal(verdict.passed, false);
  assert.match(verdict.reason, /no required term/);
});

test('freshness dominates the score', () => {
  const rules = { include: ['hiring'], staleAfterHours: 24, threshold: 0 };
  const now = scoreSignal({ title: 'hiring now', observedAt: fresh() }, rules);
  const old = scoreSignal({ title: 'hiring now', observedAt: new Date(Date.now() - 23 * 3600_000).toISOString() }, rules);
  assert.ok(now.score > old.score, `${now.score} should beat ${old.score}`);
});

test('a value below the configured minimum is rejected', () => {
  const verdict = scoreSignal(
    { title: 'bounty', payload: { reward: '25' }, observedAt: fresh() },
    { valueField: 'reward', minValue: 100 }
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.reason, /below minimum/);
});

test('processing marks, scores and promotes only what passes', async () => {
  reset();
  await registerDrone({ id: 'src', kind: 'http_json', name: 'src', targetUrl: 'https://x/a', config: {} });
  await insertSignals('src', [
    { fingerprint: 'f1', kind: 'story', title: 'Company is hiring engineers', payload: {}, observedAt: fresh() },
    { fingerprint: 'f2', kind: 'story', title: 'Unrelated chatter', payload: {}, observedAt: fresh() }
  ]);

  const promoted = [];
  const result = await processSignals({
    rulesFor: () => ({ include: ['hiring'], staleAfterHours: 24, threshold: 0.3 }),
    promote: async signal => { promoted.push(signal.title); return { ok: true }; }
  });

  assert.equal(result.claimed, 2);
  assert.equal(result.processedCount, 1);
  assert.equal(result.rejectedCount, 1);
  assert.deepEqual(promoted, ['Company is hiring engineers']);

  const stats = await signalStats();
  assert.equal(stats.byStatus.PROCESSED, 1);
  assert.equal(stats.byStatus.REJECTED, 1);
});

test('a failed promotion does not lose the scoring already committed', async () => {
  reset();
  await insertSignals('src', [{ fingerprint: 'f1', kind: 'story', title: 'hiring', payload: {}, observedAt: fresh() }]);

  const result = await processSignals({
    rulesFor: () => ({ include: ['hiring'], threshold: 0 }),
    promote: async () => { throw new Error('queue unavailable'); }
  });

  assert.equal(result.processedCount, 1);
  assert.equal((await listSignals({ status: 'PROCESSED' })).length, 1);
  assert.match(result.rejected[0].reason, /promotion failed/);
});

test('the same observation is never ingested twice', async () => {
  reset();
  const signal = { fingerprint: 'same', kind: 'story', title: 'One', payload: {}, observedAt: fresh() };
  const first = await insertSignals('src', [signal]);
  const second = await insertSignals('src', [signal]);
  assert.equal(first.inserted, 1);
  assert.equal(second.inserted, 0);
  assert.equal(second.duplicates, 1);
});
