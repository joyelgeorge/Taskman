import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLeadRecord, LEAD_CAMPAIGN_KEY, SENSITIVE_KEYS } from '../packages/core/targets/lead-record.js';

/**
 * These leads name real businesses and the vulnerability classes found in their
 * code. The operator's ruling: store the finding CLASS only — never a file
 * path, a line number, or any excerpt. The scanner already refuses to keep a
 * secret value; this is the second wall, at the persistence boundary.
 */

const scan = () => ({
  repo: 'acme/storefront',
  genuine: true,
  meta: { stargazers_count: 42, homepage: 'https://acme.example', description: 'Storefront' },
  findings: [
    { kind: 'exposed-secret', severity: 'CRITICAL', file: 'src/lib/supabase.ts', line: 12, excerpt: 'eyJhbGciOi...' },
    { kind: 'missing-rls', severity: 'CRITICAL', file: 'supabase/schema.sql', line: 88 },
    { kind: 'open-cors', severity: 'HIGH', file: 'api/index.js', line: 4 }
  ]
});

test('keeps the repo and the finding classes', () => {
  const r = toLeadRecord(scan());
  assert.equal(r.repo, 'acme/storefront');
  assert.deepEqual(r.findingClasses.sort(), ['exposed-secret', 'missing-rls', 'open-cors']);
});

test('counts findings and criticals without listing them', () => {
  const r = toLeadRecord(scan());
  assert.equal(r.findingCount, 3);
  assert.equal(r.criticalCount, 2);
});

test('NEVER stores a file path', () => {
  const serialized = JSON.stringify(toLeadRecord(scan()));
  assert.ok(!serialized.includes('src/lib/supabase.ts'), 'file path leaked into the lead record');
  assert.ok(!serialized.includes('supabase/schema.sql'), 'file path leaked into the lead record');
  assert.ok(!serialized.includes('api/index.js'), 'file path leaked into the lead record');
});

test('NEVER stores a line number', () => {
  const r = toLeadRecord(scan());
  for (const key of Object.keys(r)) assert.notEqual(key, 'line');
  assert.ok(!JSON.stringify(r).includes('"line"'));
});

test('NEVER stores an excerpt or secret value', () => {
  const serialized = JSON.stringify(toLeadRecord(scan()));
  assert.ok(!serialized.includes('eyJhbGciOi'), 'a secret excerpt reached the lead record');
  assert.ok(!serialized.includes('excerpt'));
});

test('a finding carrying an unexpected sensitive key is still dropped', () => {
  // Guards against a future audit rule adding a field nobody remembered to strip.
  const s = scan();
  s.findings[0].snippet = 'SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9';
  s.findings[0].evidence = '/abs/path/secret.env:3';
  const serialized = JSON.stringify(toLeadRecord(s));
  assert.ok(!serialized.includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(!serialized.includes('/abs/path/secret.env'));
});

test('the sensitive-key list is explicit, so the rule is reviewable', () => {
  for (const k of ['file', 'line', 'excerpt', 'snippet', 'evidence', 'match', 'value']) {
    assert.ok(SENSITIVE_KEYS.includes(k), `${k} must be on the deny list`);
  }
});

test('keeps only contact-useful public metadata', () => {
  const r = toLeadRecord(scan());
  assert.equal(r.stars, 42);
  assert.equal(r.homepage, 'https://acme.example');
});

test('records the campaign and a scan timestamp', () => {
  const r = toLeadRecord(scan(), { now: () => '2026-09-11T00:00:00.000Z' });
  assert.equal(r.campaignKey, LEAD_CAMPAIGN_KEY);
  assert.equal(r.scannedAt, '2026-09-11T00:00:00.000Z');
});

test('a repo with no findings is not a lead', () => {
  assert.equal(toLeadRecord({ repo: 'a/b', genuine: true, findings: [] }), null);
});

test('a repo with findings that is not a genuine business is not a lead', () => {
  const s = scan(); s.genuine = false;
  assert.equal(toLeadRecord(s), null);
});

test('deduplicates repeated finding classes', () => {
  const s = scan();
  s.findings.push({ kind: 'exposed-secret', severity: 'CRITICAL', file: 'other.ts', line: 1 });
  const r = toLeadRecord(s);
  assert.equal(r.findingClasses.filter(k => k === 'exposed-secret').length, 1);
  assert.equal(r.findingCount, 4, 'the count still reflects every finding');
});
