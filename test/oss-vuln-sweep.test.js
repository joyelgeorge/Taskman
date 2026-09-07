import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFindings, SECURITY_KINDS, NODE_OSS_TARGETS } from '../packages/core/bounties/oss-vuln-sweep.js';

test('a path-prefix-guard finding becomes a CWE-22 candidate, never confirmed', () => {
  const { security, quality } = classifyFindings([
    { kind: 'path-prefix-guard', file: 'server.js', line: 40, evidence: 'x.startsWith(dir)', confirm: 'request an encoded sibling path' }
  ], { repo: 'a/b' });
  assert.equal(security.length, 1);
  assert.equal(quality.length, 0);
  assert.equal(security[0].cwe, 'CWE-22');
  assert.equal(security[0].status, 'CANDIDATE-needs-PoC');
  assert.match(security[0].poc, /encoded sibling/);
});

test('reliability findings are quality, not security submissions', () => {
  const { security, quality } = classifyFindings([
    { kind: 'silent-fallback', file: 'a.js', line: 1 },
    { kind: 'date-shift', file: 'b.js', line: 2 },
    { kind: 'storage-divergence', file: 'c.js', line: 3 }
  ], { repo: 'a/b' });
  assert.equal(security.length, 0);
  assert.equal(quality.length, 3);
});

test('SECURITY_KINDS holds only classes that map to a bounty-payable vuln', () => {
  assert.ok(SECURITY_KINDS.has('path-prefix-guard'));
  assert.ok(!SECURITY_KINDS.has('silent-fallback'));
});

test('seed targets are Node.js repos with a named server subtree and a scope reason', () => {
  assert.ok(NODE_OSS_TARGETS.length >= 3);
  for (const t of NODE_OSS_TARGETS) {
    assert.ok(t.repo.includes('/'), 'repo is owner/name');
    assert.ok(typeof t.subdir === 'string');
    assert.ok(t.scope && t.scope.length > 0, 'every target states why it is in scope');
  }
});
