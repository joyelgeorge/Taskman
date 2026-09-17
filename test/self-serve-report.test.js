import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFix, freeReport, paidReport } from '../packages/core/self-serve/report.js';

/**
 * The self-serve product's core: turn a scan into a free teaser (counts only)
 * and a paid report (the exact fixes). The fix generator is the moat — the scan
 * is free everywhere, the fix is what someone pays for.
 */

const findings = [
  { kind: 'exposed-secret', file: 'https://app/x.js', evidence: 'service_role key' },
  { kind: 'missing-rls', file: 'schema.sql', evidence: 'table: orders' },
  { kind: 'missing-rls', file: 'schema.sql', evidence: 'table: users' },
  { kind: 'open-cors', file: 'https://app/api.js' }
];

test('the free report gives counts and NO remediation detail', () => {
  const r = freeReport({ app: 'https://app/', findings });
  assert.equal(r.total, 4);
  assert.equal(r.byKind['exposed-secret'], 1);
  assert.equal(r.byKind['missing-rls'], 2);
  // The teaser must not leak the fix — that is what is being sold.
  const blob = JSON.stringify(r).toLowerCase();
  assert.ok(!blob.includes('alter table'), 'no SQL in the free tier');
  assert.ok(!blob.includes('rotate'), 'no fix steps in the free tier');
  assert.equal(r.locked, true);
});

test('a fix is generated for an exposed key: rotate first, env second', () => {
  const fix = generateFix({ kind: 'exposed-secret', evidence: 'service_role key' });
  assert.match(fix.steps.join(' '), /rotate/i);
  assert.ok(fix.steps.some(s => /env|environment/i.test(s)), 'move to env');
  assert.ok(fix.steps.join(' ').includes('history') || /git/i.test(fix.steps.join(' ')),
    'must warn the old key stays in history');
});

test('a fix is generated for missing RLS: real SQL, per table', () => {
  const fix = generateFix({ kind: 'missing-rls', evidence: 'table: orders' });
  assert.match(fix.steps.join('\n'), /alter table\s+orders\s+enable row level security/i);
  assert.match(fix.steps.join('\n'), /create policy/i);
});

test('a fix is generated for open CORS', () => {
  const fix = generateFix({ kind: 'open-cors' });
  assert.ok(fix.steps.length > 0);
  assert.match(fix.steps.join(' '), /origin/i);
});

test('the paid report carries a fix for every finding', () => {
  const r = paidReport({ app: 'https://app/', findings });
  assert.equal(r.locked, false);
  assert.equal(r.fixes.length, 4);
  for (const f of r.fixes) assert.ok(f.steps && f.steps.length, 'every finding has actionable steps');
});

test('an unknown finding kind still yields a safe generic fix, never a crash', () => {
  const fix = generateFix({ kind: 'something-new' });
  assert.ok(fix.steps.length > 0);
});

test('the free and paid reports agree on the counts — the teaser is honest', () => {
  const free = freeReport({ app: 'https://app/', findings });
  const paid = paidReport({ app: 'https://app/', findings });
  assert.equal(free.total, paid.fixes.length);
});
