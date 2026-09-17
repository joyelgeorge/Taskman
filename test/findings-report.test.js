import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeFindings, headline, proveFixed } from '../packages/core/findings/report.js';

/**
 * The measured case this module exists for: one repository produced 70
 * missing-RLS findings across 12 files, and the report led with "70 criticals".
 */
const flyrpro = () => {
  const out = [];
  for (let i = 0; i < 70; i += 1) {
    out.push({ kind: 'missing-rls', file: `db/schema-${i % 12}.sql`, line: i + 1 });
  }
  out.push({ kind: 'exposed-secret', file: 'src/client.js', line: 4 });
  return out;
};

test('70 findings across 12 files is reported as 12 problems, not 70', () => {
  const s = summarizeFindings(flyrpro());

  const rls = s.kinds.find(k => k.kind === 'missing-rls');
  assert.equal(rls.findings, 70, 'the raw count is kept, so the gap stays visible');
  assert.equal(rls.files, 12);
  assert.equal(rls.problems, 12, 'one problem per file — never seventy');

  assert.equal(s.totalFindings, 71);
  assert.equal(s.totalProblems, 13);
  assert.equal(s.inflation, 5.46, 'the raw count overstates the work by 5.5x');
});

test('the headline never quotes the raw total alone', () => {
  const line = headline(summarizeFindings(flyrpro()));
  assert.match(line, /13 problems across 13 files/);
  assert.match(line, /71 raw findings/, 'both numbers, because the difference is the point');
  assert.doesNotMatch(line, /^71/, 'the raw count must never lead');
});

test('when the counts agree the headline does not editorialise', () => {
  const line = headline(summarizeFindings([
    { kind: 'exposed-secret', file: 'a.js', line: 1 },
    { kind: 'open-cors', file: 'b.js', line: 2 }
  ]));
  assert.equal(line, '2 problems across 2 files.');
});

test('an exposed secret outranks a pile of missing RLS', () => {
  const s = summarizeFindings(flyrpro());
  assert.equal(s.kinds[0].kind, 'exposed-secret',
    'severity order decides what leads, not which kind has the biggest count');
});

test('empty input says so rather than reporting zero problems across zero files', () => {
  assert.equal(headline(summarizeFindings([])), 'No findings.');
});

// ---------------------------------------------------------------- proof of fix

test('a re-run proves which findings are gone', () => {
  const before = [
    { kind: 'exposed-secret', file: 'src/client.js', line: 4 },
    { kind: 'missing-rls', file: 'db/schema.sql', line: 10 },
    { kind: 'open-cors', file: 'src/api.js', line: 2 }
  ];
  const after = [
    { kind: 'missing-rls', file: 'db/schema.sql', line: 10 }
  ];

  const proof = proveFixed({ before, after, observedAt: '2026-09-18T00:00:00.000Z' });

  assert.equal(proof.fixedCount, 2);
  assert.equal(proof.remainingCount, 1);
  assert.equal(proof.introducedCount, 0);
  assert.equal(proof.clean, false, 'one finding remains, so this is not a clean bill');
  assert.deepEqual(proof.fixed.map(f => f.kind).sort(), ['exposed-secret', 'open-cors']);
  assert.equal(proof.observedAt, '2026-09-18T00:00:00.000Z');
});

test('a re-run that fixed nothing says so', () => {
  const same = [{ kind: 'exposed-secret', file: 'src/client.js', line: 4 }];
  const proof = proveFixed({ before: same, after: same });
  assert.equal(proof.fixedCount, 0);
  assert.equal(proof.remainingCount, 1);
  assert.equal(proof.clean, false);
});

test('a fix that introduced a new finding is reported, not swallowed', () => {
  const proof = proveFixed({
    before: [{ kind: 'missing-rls', file: 'db/schema.sql', line: 10 }],
    after: [{ kind: 'exposed-secret', file: 'src/new.js', line: 1 }]
  });
  assert.equal(proof.fixedCount, 1);
  assert.equal(proof.introducedCount, 1);
  assert.equal(proof.clean, false, 'trading one finding for another is not clean');
});

test('everything fixed is the only thing that reads as clean', () => {
  const proof = proveFixed({
    before: [{ kind: 'exposed-secret', file: 'src/client.js', line: 4 }],
    after: []
  });
  assert.equal(proof.clean, true);
  assert.equal(proof.fixedCount, 1);
});
