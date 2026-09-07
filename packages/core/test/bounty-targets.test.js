import test from 'node:test';
import assert from 'node:assert/strict';
import { OSS_BOUNTY_TARGETS, isReportable } from '../income/bounty-targets.js';

test('every target publishes source, which is what makes reading it legal', () => {
  // A normal bounty target is a black box that may not be scanned without that
  // program's permission. These are different: the code is published, so reading
  // it is not an intrusion — and that is the only reason the scanner has anywhere
  // to point.
  assert.ok(OSS_BOUNTY_TARGETS.length >= 3);
  for (const t of OSS_BOUNTY_TARGETS) {
    assert.match(t.program, /^https:\/\/hackerone\.com\//);
    assert.ok(t.why && t.evidence, `${t.key} must carry its reasoning and its evidence`);
    assert.ok(['verified', 'assumed'].includes(t.confidence));
  }
});

test('a payments-domain target exists, because that is where the expertise is', () => {
  const payments = OSS_BOUNTY_TARGETS.filter(t => t.domain === 'payments');
  assert.ok(payments.length >= 1, 'the whole point is the overlap with payout expertise');
});

test('nothing is ever automatically reportable as a security finding', () => {
  // A new researcher's first reports set how the later ones are read. A queue of
  // valid-but-not-security findings is a worse opening than silence, so this
  // never green-lights a submission — security impact is an argument about what
  // an attacker gains, which cannot be derived from the shape of the code.
  for (const kind of ['silent-fallback', 'missing-table', 'storage-divergence', 'date-shift']) {
    const verdict = isReportable({ kind });
    assert.equal(verdict.reportable, false, kind);
    assert.ok(verdict.guidance.length > 30, `${kind} must say what would make it qualify`);
  }
});

test('storage divergence is explicitly not a vulnerability on its own', () => {
  // It explains why a suite is green while production is not. That is worth
  // money as an audit finding and is not worth filing as a security report.
  assert.match(isReportable({ kind: 'storage-divergence' }).guidance, /not on its own/);
});

test('an unknown finding class is judged on impact rather than waved through', () => {
  assert.match(isReportable({ kind: 'something-new' }).guidance, /judge it on impact/);
});
