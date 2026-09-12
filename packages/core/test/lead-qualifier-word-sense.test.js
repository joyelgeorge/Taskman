import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualifyLead } from '../targets/lead-qualifier.js';

/**
 * The 2026-09-12 sweep rejected its single best lead — a real company with a
 * custom domain, sustained development and FOUR critical findings — because its
 * description said "portfolio optimization" and a keyword filter matched the
 * bare word `portfolio`.
 *
 * Measured against ten plausible business descriptions, the filter rejected
 * nine. These words are ordinary domain vocabulary: portfolio optimization,
 * machine learning, course marketplace, practice management, sample tracking.
 * `learning` is the worst of them in a market defined as AI-built apps.
 *
 * The rule these tests pin: a word that is ambiguous may not hard-reject a repo
 * that carries strong evidence of being a real product. An unambiguous one still
 * may.
 */

const realBusiness = (description, extra = {}) => ({
  name: 'acme-app',
  description,
  homepage: 'https://acme.example',      // custom domain — strong evidence
  stargazers_count: 9, forks_count: 0,
  archived: false, fork: false,
  created_at: '2026-02-03T00:00:00Z', pushed_at: '2026-09-10T00:00:00Z',
  ...extra
});

// ---- the regression that motivated this ----

test('the lead the sweep threw away now qualifies', () => {
  const q = qualifyLead(realBusiness(
    'Cognitive Factor Intelligence Platform — AI-powered portfolio optimization with '
    + '80+ factors, episodic learning (CVRF), Connect Alpaca, paper trading. Metaventions AI.'
  ), { hasPayments: false, hasAuth: true });
  assert.equal(q.genuine, true, 'a real company with a custom domain is not a toy because it said "portfolio"');
  assert.deepEqual(q.rejections, []);
});

// ---- ambiguous words are domain vocabulary, not verdicts ----

for (const [word, description] of [
  ['portfolio', 'Investment portfolio tracker with live brokerage sync'],
  ['learning',  'Machine learning platform for demand forecasting'],
  ['course',    'Online course marketplace for professional trainers'],
  ['practice',  'Practice management software for dental clinics'],
  ['sample',    'Sample tracking for clinical laboratories'],
  ['workshop',  'Workshop booking and scheduling for auto repair shops'],
  ['demo',      'Demo day pitch platform for accelerators']
]) {
  test(`"${word}" as domain vocabulary does not reject a real product`, () => {
    const q = qualifyLead(realBusiness(description), { hasPayments: true });
    assert.equal(q.genuine, true, `rejected on "${word}": ${JSON.stringify(q.rejections)}`);
  });
}

// ---- but the filter must still do its job ----

test('an unambiguous toy word still rejects, even with a homepage', () => {
  const q = qualifyLead(realBusiness('A Next.js SaaS boilerplate to start your project'), { hasPayments: true });
  assert.equal(q.genuine, false);
  assert.match(q.rejections.join(' '), /boilerplate/i);
});

test('a starter kit is still rejected', () => {
  const q = qualifyLead({ ...realBusiness('Stripe subscription starter kit'), name: 'saas-starter-nextjs' });
  assert.equal(q.genuine, false);
});

test('an ambiguous word in the repo NAME is treated as a toy signal', () => {
  // "my-portfolio" names the artifact; "portfolio optimization" describes a domain.
  const q = qualifyLead({ ...realBusiness('Personal site'), name: 'my-portfolio' });
  assert.equal(q.genuine, false);
  assert.match(q.rejections.join(' '), /portfolio/i);
});

test('an ambiguous word with NO strong evidence still rejects', () => {
  const q = qualifyLead({
    name: 'thing', description: 'A demo of what I learned',
    homepage: null, has_pages: false, stargazers_count: 0, forks_count: 0,
    archived: false, fork: false,
    created_at: '2026-09-01T00:00:00Z', pushed_at: '2026-09-02T00:00:00Z'
  });
  assert.equal(q.genuine, false);
});

test('a github.io or platform subdomain is not strong evidence on its own', () => {
  const q = qualifyLead({ ...realBusiness('A portfolio of my work'), homepage: 'https://someone.github.io' });
  assert.equal(q.genuine, false, 'a hosting subdomain does not make a portfolio a business');
});

test('archived and forked repos are still hard rejections', () => {
  assert.equal(qualifyLead(realBusiness('Real product', { archived: true })).genuine, false);
  assert.equal(qualifyLead(realBusiness('Real product', { fork: true })).genuine, false);
});

test('a plain business with no trigger words is unaffected', () => {
  const q = qualifyLead(realBusiness('CRM for solar installers'), { hasPayments: true });
  assert.equal(q.genuine, true);
});
