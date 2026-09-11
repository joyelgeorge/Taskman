import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCAN_OUTCOME, recordScanned, listScanned, selectUnscanned, resetScanMemoryForTesting
} from '../packages/core/targets/scan-memory.js';

const reset = () => resetScanMemoryForTesting();

test('remembers a scanned repo', async () => {
  reset();
  await recordScanned({ repo: 'a/one', outcome: SCAN_OUTCOME.LEAD, findingCount: 2 });
  const all = await listScanned();
  assert.equal(all.length, 1);
  assert.equal(all[0].repo, 'a/one');
  assert.equal(all[0].outcome, 'LEAD');
});

test('re-scanning the same repo does not duplicate it', async () => {
  reset();
  await recordScanned({ repo: 'a/one', outcome: SCAN_OUTCOME.CLEAN });
  await recordScanned({ repo: 'a/one', outcome: SCAN_OUTCOME.LEAD, findingCount: 1 });
  const all = await listScanned();
  assert.equal(all.length, 1);
  assert.equal(all[0].outcome, 'LEAD', 'the newer outcome wins');
  assert.equal(all[0].scanCount, 2, 'but we remember it was seen twice');
});

test('rejects an outcome the schema would not accept', async () => {
  reset();
  await assert.rejects(() => recordScanned({ repo: 'a/one', outcome: 'MAYBE' }), /outcome/i);
});

test('requires a repo', async () => {
  reset();
  await assert.rejects(() => recordScanned({ outcome: SCAN_OUTCOME.CLEAN }), /repo/i);
});

test('skips repos scanned inside the window — this is the whole point', async () => {
  reset();
  const now = Date.parse('2026-09-11T00:00:00Z');
  await recordScanned({ repo: 'a/seen', outcome: SCAN_OUTCOME.CLEAN, now: () => new Date(now).toISOString() });
  const fresh = await selectUnscanned(['a/seen', 'b/new'], { withinDays: 30, now: () => now });
  assert.deepEqual(fresh, ['b/new']);
});

test('re-offers a repo once the window has passed', async () => {
  reset();
  const scannedAt = Date.parse('2026-01-01T00:00:00Z');
  await recordScanned({ repo: 'a/old', outcome: SCAN_OUTCOME.CLEAN, now: () => new Date(scannedAt).toISOString() });
  const later = Date.parse('2026-09-11T00:00:00Z');
  const fresh = await selectUnscanned(['a/old'], { withinDays: 30, now: () => later });
  assert.deepEqual(fresh, ['a/old'], 'code changes; a stale clean result is not permanent');
});

test('an errored scan is retried sooner than a clean one', async () => {
  reset();
  const at = Date.parse('2026-09-10T00:00:00Z');
  await recordScanned({ repo: 'a/err', outcome: SCAN_OUTCOME.ERROR, now: () => new Date(at).toISOString() });
  const next = Date.parse('2026-09-13T00:00:00Z');
  const fresh = await selectUnscanned(['a/err'], { withinDays: 30, retryErrorsAfterDays: 1, now: () => next });
  assert.deepEqual(fresh, ['a/err']);
});

test('preserves the order the candidates arrived in', async () => {
  reset();
  const fresh = await selectUnscanned(['c/3', 'a/1', 'b/2'], {});
  assert.deepEqual(fresh, ['c/3', 'a/1', 'b/2']);
});

test('handles an empty candidate list', async () => {
  reset();
  assert.deepEqual(await selectUnscanned([], {}), []);
});
