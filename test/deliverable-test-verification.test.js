import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyDeliverableTests } from '../src/autonomous-engine.js';

/**
 * BRAIN-TRANSFER.md §15 states the rule this file enforces: testsPassed /
 * TESTED_AND_READY must never be set without an ACTUAL test run against a
 * source file that exists. The previous implementation checked only that the
 * files existed, so a failing test staged as TESTED_AND_READY.
 */

// MUST await fn: returning the promise unawaited lets the finally block delete
// the directory while the test process is still running inside it, which makes
// a failing-case assertion pass for the wrong reason.
const withRepo = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'jez-deliv-'));
  // A bare temp dir is CommonJS to Node; the generated ESM test needs this.
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

const PASSING = `
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('passes', () => { assert.equal(1, 1); });
`;

const FAILING = `
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fails', () => { assert.equal(1, 2); });
`;

test('a candidate with no patch file is not tested and not ready', async () => {
  await withRepo(async (dir) => {
    const r = await verifyDeliverableTests({ patchFile: null, testFile: null, cwd: dir });
    assert.equal(r.testsPassed, false);
    assert.equal(r.status, 'PENDING_IMPLEMENTATION');
  });
});

test('a patch file that does not exist on disk is not ready', async () => {
  await withRepo(async (dir) => {
    const r = await verifyDeliverableTests({
      patchFile: 'src/nope.js', testFile: 'test/nope.test.js', cwd: dir
    });
    assert.equal(r.testsPassed, false);
    assert.equal(r.status, 'PENDING_IMPLEMENTATION');
  });
});

test('a patch with no test file is UNTESTED, never ready', async () => {
  await withRepo(async (dir) => {
    writeFileSync(join(dir, 'impl.js'), 'export const x = 1;\n');
    const r = await verifyDeliverableTests({ patchFile: 'impl.js', testFile: null, cwd: dir });
    assert.equal(r.testsPassed, false);
    assert.equal(r.status, 'UNTESTED');
  });
});

test('a FAILING test file is never TESTED_AND_READY — the bug this guards', async () => {
  await withRepo(async (dir) => {
    writeFileSync(join(dir, 'impl.js'), 'export const x = 1;\n');
    writeFileSync(join(dir, 'impl.test.js'), FAILING);
    const r = await verifyDeliverableTests({
      patchFile: 'impl.js', testFile: 'impl.test.js', cwd: dir
    });
    assert.equal(r.testsPassed, false, 'a failing test must not report testsPassed');
    assert.equal(r.status, 'TESTS_FAILING');
    assert.ok(r.ran, 'the test must actually have been executed');
  });
});

test('a PASSING test file is TESTED_AND_READY', async () => {
  await withRepo(async (dir) => {
    writeFileSync(join(dir, 'impl.js'), 'export const x = 1;\n');
    writeFileSync(join(dir, 'impl.test.js'), PASSING);
    const r = await verifyDeliverableTests({
      patchFile: 'impl.js', testFile: 'impl.test.js', cwd: dir
    });
    assert.equal(r.testsPassed, true);
    assert.equal(r.status, 'TESTED_AND_READY');
    assert.ok(r.ran);
  });
});

test('file existence alone is not evidence — both cases have files present', async () => {
  await withRepo(async (dir) => {
    writeFileSync(join(dir, 'a.js'), 'export const x = 1;\n');
    writeFileSync(join(dir, 'a.test.js'), FAILING);
    writeFileSync(join(dir, 'b.js'), 'export const x = 1;\n');
    writeFileSync(join(dir, 'b.test.js'), PASSING);
    const bad = await verifyDeliverableTests({ patchFile: 'a.js', testFile: 'a.test.js', cwd: dir });
    const good = await verifyDeliverableTests({ patchFile: 'b.js', testFile: 'b.test.js', cwd: dir });
    assert.notEqual(bad.status, good.status,
      'identical file-presence must not yield identical verdicts');
  });
});
