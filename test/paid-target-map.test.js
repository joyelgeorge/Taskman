import test from 'node:test';
import assert from 'node:assert/strict';
import { paidSignal, credentialScore, rankTargets } from '../packages/core/targets/paid-target-map.js';

test('paidSignal counts only a huntr bounty or a listed program as money, not a plain advisory', () => {
  assert.equal(paidSignal(['https://github.com/x/y/security/advisories/GHSA-1']).pays, false);
  assert.equal(paidSignal(['https://nvd.nist.gov/vuln/detail/CVE-1']).pays, false);
  assert.equal(paidSignal(['https://huntr.com/bounties/abc']).pays, true);
  assert.equal(paidSignal(['https://hackerone.com/acme']).via, 'program-listed');
});

test('credentialScore rewards fresh, severe, repeat-offender packages', () => {
  const hot = credentialScore({ severity: 'critical', ageDays: 10, sameClassCount: 4 });
  const cold = credentialScore({ severity: 'low', ageDays: 800, sameClassCount: 1 });
  assert.ok(hot > cold);
  assert.ok(hot >= 0.85 && hot <= 1);
});

test('rankTargets puts a payer above a higher-credential non-payer', () => {
  const ranked = rankTargets([
    { pkg: 'unpaid', severity: 'critical', ageDays: 5, sameClassCount: 5, references: ['https://github.com/a/b'] },
    { pkg: 'paid', severity: 'medium', ageDays: 300, sameClassCount: 1, references: ['https://huntr.com/bounties/z'] }
  ]);
  assert.equal(ranked[0].pkg, 'paid', 'a real payer outranks a credential-only target');
});
