import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findSilentFallback, findDateShift, findMissingTables, findStorageDivergence
} from '../src/codebase-audit.js';

test('a catch that returns success is reported', () => {
  // The shape that hid outreach_drafts for months: the write failed on every
  // call, the error was swallowed, and the caller was told it saved.
  const code = `try { await query('INSERT INTO x'); } catch (err) { mem.set(id, row); return { ok: true }; }`;
  const [finding] = findSilentFallback('a.js', code);
  assert.equal(finding.kind, 'silent-fallback');
  assert.match(finding.why, /told it worked/);
  assert.ok(finding.confirm, 'every finding must carry the check that settles it');
});

test('an ordinary catch that rethrows or returns failure is left alone', () => {
  assert.equal(findSilentFallback('a.js', `try { x(); } catch (e) { throw e; }`).length, 0);
  assert.equal(findSilentFallback('a.js', `try { x(); } catch (e) { return { ok: false }; }`).length, 0);
});

test('a DATE run through toISOString is reported; a timestamp is not', () => {
  // A DATE has no time, so converting it to UTC moves the day. An _at column is
  // a timestamptz where the same call is correct — including those produced 29
  // findings on a real repository, almost all of them fine.
  assert.equal(findDateShift('a.js', 'row.bucket_date.toISOString()').length, 1);
  assert.equal(findDateShift('a.js', 'row.snapshotDate.toISOString()').length, 1);
  assert.equal(findDateShift('a.js', 'row.created_at.toISOString()').length, 0);
  assert.equal(findDateShift('a.js', 'row.startedAt.toISOString()').length, 0);
});

test('only real SQL writes count as writes to a missing table', () => {
  // The first version reported "set", "a" and "pr" as tables — UPDATE is followed
  // by SET, and prose in a comment matches the same shape. Eleven findings, one
  // real. A scanner wrong ten times in eleven teaches its reader to skip it.
  const writes = [
    { table: 'outreach_drafts', file: 'a.js', line: 1 },
    { table: 'settlements', file: 'b.js', line: 2 }
  ];
  const findings = findMissingTables({ writes, creates: [{ table: 'settlements' }] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].evidence.includes('outreach_drafts'), true);
});

test('an in-memory fallback branch is detected', () => {
  const found = findStorageDivergence('a.js', 'if (!databaseEnabled) { return mem.all(); }');
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'storage-divergence');
});

test('findings are candidates and say so, never verdicts', async () => {
  const { auditCodebase } = await import('../src/codebase-audit.js');
  const result = await auditCodebase(process.cwd(), { maxFiles: 40 });
  assert.match(result.caveat, /candidates, not confirmed/);
  for (const f of result.findings) {
    assert.ok(f.confirm, `${f.kind} must say how to settle it`);
  }
});
