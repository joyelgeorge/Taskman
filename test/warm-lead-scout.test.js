import test from 'node:test';
import assert from 'node:assert/strict';
import { warmLeadCandidates, WARM_QUERIES } from '../packages/core/marketing/warm-lead-scout.js';

/**
 * The repo calls warm-lead-scout the primary engine, then never built it. This
 * automates the discovery half — surfacing people asking for help securing their
 * vibe-coded app — from GitHub issue/discussion search, which is public,
 * read-only, and reliably reachable. The judgement (is this genuine intent?) and
 * the reply stay human, because reading a thread cannot be faked.
 */

const issue = (over = {}) => ({
  title: 'How do I secure my Supabase RLS?',
  html_url: 'https://github.com/someone/app/issues/3',
  state: 'open',
  user: { login: 'someone' },
  created_at: '2026-09-14T00:00:00Z',
  ...over
});

test('an open help-request becomes a warm-lead candidate keyed on its URL', () => {
  const c = warmLeadCandidates([issue()]);
  assert.equal(c.length, 1);
  assert.equal(c[0].url, 'https://github.com/someone/app/issues/3');
  assert.equal(c[0].source, 'github-issue');
  assert.equal(c[0].needsHumanRead, true, 'intent must be read by a person before contact');
});

test('duplicates by URL collapse to one', () => {
  const c = warmLeadCandidates([issue(), issue()]);
  assert.equal(c.length, 1);
});

test('a closed thread is dropped — the moment has passed', () => {
  assert.equal(warmLeadCandidates([issue({ state: 'closed' })]).length, 0);
});

test('our own operator is never surfaced as a lead', () => {
  assert.equal(warmLeadCandidates([issue({ user: { login: 'joyelgeorge' } })], { self: 'joyelgeorge' }).length, 0);
});

test('the queries target help-seeking, not generic mentions', () => {
  assert.ok(WARM_QUERIES.length >= 3);
  for (const q of WARM_QUERIES) {
    assert.match(q, /help|how to|how do|secure|insecure|exposed|hacked|leak/i, `"${q}" is not a help-seeking query`);
  }
});

test('a candidate carries enough to act without re-deriving it', () => {
  const c = warmLeadCandidates([issue()])[0];
  assert.ok(c.title && c.url && c.createdAt);
});
