import test from 'node:test';
import assert from 'node:assert/strict';
import { assertValidJob, isRunnableJob, JOB_STAGE } from '../packages/core/jobs/job-spec.js';
import { runJob, STAGE_OUTCOME } from '../packages/core/jobs/runner.js';
import { EXPLORED_TERRITORIES } from '../packages/core/territory/registry.js';
import {
  vibeAppSecurityJob, classifyFindings, rankLeads, draftDisclosure
} from '../packages/core/jobs/vibe-app-security.js';

test('the lane is a registered, runnable revenue job', () => {
  const entry = EXPLORED_TERRITORIES.find(t => t.key === 'vibe-app-security');
  assert.ok(entry, 'the lane must be in the single registry, not a parallel list');
  assertValidJob(entry);
  assert.equal(isRunnableJob(entry), true);
});

test('classification separates a real leaked key from one systemic issue counted per table', () => {
  const findings = [
    { kind: 'exposed-secret', file: 'scripts/a.ts', line: 70 },
    ...Array.from({ length: 70 }, (_, i) => ({ kind: 'missing-rls', file: i < 56 ? 'schema.sql' : `m/${i}.sql` }))
  ];
  const c = classifyFindings(findings);

  assert.equal(c.compelling, 1, 'only the exposed secret compels action');
  assert.equal(c.byKind['missing-rls'].count, 70);
  assert.equal(c.byKind['missing-rls'].files, 15, 'distinct files, which is the honest number');
  assert.equal(c.headline, 71);
  assert.ok(c.inflationRatio > 10, 'the headline must be reported as inflated');
});

test('ranking puts a leaked key above a large pile of missing RLS', () => {
  const ranked = rankLeads([
    { repo: 'rls-only', findings: Array.from({ length: 70 }, () => ({ kind: 'missing-rls', file: 'schema.sql' })) },
    { repo: 'has-secret', findings: [{ kind: 'exposed-secret', file: 'a.ts' }] }
  ]);

  assert.equal(ranked[0].repo, 'has-secret',
    'ranking by raw finding count is how a 70-row RLS dump outranks a live leaked key');
});

/**
 * Defence in depth, verified by mutation rather than assumed. The template does
 * not interpolate `evidence` today, so removing scrubSecrets alone changes
 * nothing and this test would pass for the wrong reason. Proven on 2026-09-15 by
 * interpolating evidence AND removing scrubSecrets: the draft then leaks and
 * this test fails. With scrubSecrets present it does not. The redaction is what
 * protects a future edit to the template.
 */
test('a drafted disclosure carries the corrected number and never the secret value', () => {
  const draft = draftDisclosure({
    repo: 'owner/app',
    findings: [
      { kind: 'exposed-secret', file: 'src/db.ts', line: 12, evidence: 'KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sIgNaTuRe' },
      { kind: 'missing-rls', file: 'schema.sql' }
    ]
  });

  assert.match(draft, /src\/db\.ts:12/, 'the location is the useful part');
  assert.doesNotMatch(draft, /sIgNaTuRe/, 'the secret value must never be written down');
  assert.doesNotMatch(draft, /eyJyb2xl/, 'not even partially');
  assert.match(draft, /rotate/i, 'rotation comes before everything else');
  assert.doesNotMatch(draft, /\$\d/, 'no price in the first message');
  assert.match(draft, /DRAFT — NOT SENT/);
});

test('the job cannot reach out without an operator approval token', async () => {
  const result = await runJob(vibeAppSecurityJob({
    scan: async () => [{ repo: 'owner/app', findings: [{ kind: 'exposed-secret', file: 'a.ts', line: 1 }] }]
  }), { log: async () => {} });

  assert.equal(result.stopped, JOB_STAGE.INTERVENE);
  assert.equal(result.charged, false);
});

test('with approval the job drafts, and still records nothing as money', async () => {
  const drafted = [];
  const result = await runJob(vibeAppSecurityJob({
    scan: async () => [{ repo: 'owner/app', findings: [{ kind: 'exposed-secret', file: 'a.ts', line: 1 }] }],
    write: async (path, text) => { drafted.push({ path, text }); }
  }), { approval: 'operator:joyel', log: async () => {} });

  assert.equal(drafted.length, 1);
  assert.match(drafted[0].path, /docs\/outreach\//);
  // No payment evidence, so the evidence gate refuses the charge. It stops AT
  // charge rather than before it, which is the more useful record: the attempt
  // log gets a row saying exactly why money was not taken.
  assert.equal(result.charged, false);
  assert.equal(result.stopped, JOB_STAGE.CHARGE);
  const charge = result.runs.at(-1);
  assert.equal(charge.outcome, STAGE_OUTCOME.REFUSED);
  assert.match(charge.reason, /reference|evidence/i);
});

test('charge runs only once a payment reference exists, and the runner records it', async () => {
  const settled = [];
  const result = await runJob(vibeAppSecurityJob({
    scan: async () => [{ repo: 'owner/app', findings: [{ kind: 'exposed-secret', file: 'a.ts', line: 1 }] }],
    write: async () => {},
    payment: async () => ({ source: 'manual_receipt', externalRef: 'UPI-77120', grossCents: 11000, currency: 'INR' })
  }), { approval: 'operator:joyel', log: async () => {}, settle: async (s) => { settled.push(s); return s; } });

  assert.equal(result.charged, true);
  assert.equal(settled[0].externalRef, 'UPI-77120');
  assert.equal(settled[0].rail, 'vibe-app-security');
  assert.equal(settled[0].grossCents, 11000);
});
