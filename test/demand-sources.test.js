import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEMAND_SOURCES, REACH, INTENT, sortedSources, runnableSources,
  recordYield, deadQueries, yieldReport
} from '../packages/core/marketing/demand-sources.js';

test('sources are ordered by intent strength, paying first', () => {
  const order = sortedSources().map(s => s.intent);
  assert.equal(order[0], INTENT.PAYING, 'someone offering money outranks someone asking');
  assert.equal(order.at(-1), INTENT.LATENT, 'a repo that merely has the problem ranks last');
  // No latent source may appear before an asking source.
  const firstLatent = order.indexOf(INTENT.LATENT);
  const lastAsking = order.lastIndexOf(INTENT.ASKING);
  assert.ok(firstLatent > lastAsking, 'intent ranking must hold across the whole list');
});

test('an unrunnable source reports why instead of vanishing', () => {
  // A web session: no gh, no outbound http, no browser.
  const here = runnableSources({ [REACH.GITHUB_API]: false, [REACH.HTTP]: false, [REACH.BROWSER]: false });

  assert.equal(here.length, DEMAND_SOURCES.length,
    'nothing is filtered away — "could not look" must never look like "found nothing"');
  const gh = here.find(s => s.key === 'github-warm-issues');
  assert.equal(gh.runnable, false);
  assert.match(gh.blockedReason, /needs github-api/);
});

test('the forum source is declared BROWSER because a crawler is refused there', () => {
  const forums = DEMAND_SOURCES.find(s => s.key === 'forum-help-threads');
  assert.equal(forums.reach, REACH.BROWSER,
    'Reddit and Stack Overflow refuse the crawler — measured, not assumed');
  const inActions = runnableSources({ [REACH.GITHUB_API]: true, [REACH.HTTP]: true, [REACH.BROWSER]: false });
  assert.equal(inActions.find(s => s.key === 'forum-help-threads').runnable, false,
    'having a token and a network does not make a refused crawl runnable');
  assert.equal(inActions.find(s => s.key === 'github-warm-issues').runnable, true);
});

test('yield is recorded per query, because that is the grain at which a lookup dies', () => {
  let h = [];
  h = recordYield(h, { sourceKey: 'github-warm-issues', query: 'a', candidates: 4, at: '2026-09-01T00:00:00Z' });
  h = recordYield(h, { sourceKey: 'github-warm-issues', query: 'b', candidates: 0, at: '2026-09-01T00:00:00Z' });
  assert.equal(h.length, 2);
  assert.equal(h[0].query, 'a');
  assert.equal(h[1].candidates, 0);
});

test('recording yield without a subject is refused', () => {
  assert.throws(() => recordYield([], { candidates: 3 }), /sourceKey and query are required/);
});

test('a query that has never produced anything is named after enough runs', () => {
  let h = [];
  for (let i = 0; i < 6; i += 1) {
    h = recordYield(h, { sourceKey: 'github-warm-issues', query: 'dead one', candidates: 0 });
    h = recordYield(h, { sourceKey: 'github-warm-issues', query: 'live one', candidates: 2 });
  }
  const dead = deadQueries(h, { minRuns: 5 });
  assert.equal(dead.length, 1, 'only the query that produced nothing');
  assert.equal(dead[0].query, 'dead one');
  assert.equal(dead[0].runs, 6);
});

test('a new query is not retired before it has had a chance', () => {
  let h = [];
  h = recordYield(h, { sourceKey: 's', query: 'brand new', candidates: 0 });
  h = recordYield(h, { sourceKey: 's', query: 'brand new', candidates: 0 });
  assert.deepEqual(deadQueries(h, { minRuns: 5 }), [],
    'two empty runs is unlucky; ten is dead');
});

test('the yield report ranks lookups by what they actually return', () => {
  let h = [];
  h = recordYield(h, { sourceKey: 's', query: 'weak', candidates: 1 });
  h = recordYield(h, { sourceKey: 's', query: 'weak', candidates: 1 });
  h = recordYield(h, { sourceKey: 's', query: 'strong', candidates: 10 });

  const r = yieldReport(h);
  assert.equal(r.rows[0].query, 'strong');
  assert.equal(r.rows[0].perRun, 10);
  assert.equal(r.rows[1].perRun, 1);
  assert.equal(r.totalCandidates, 12);
  assert.equal(r.measuredQueries, 2);
});

test('an empty history reports nothing measured rather than nothing found', () => {
  const r = yieldReport([]);
  assert.equal(r.measuredQueries, 0);
  assert.equal(r.totalCandidates, 0);
  assert.deepEqual(deadQueries([]), [], 'no measurements means no verdicts');
});

test('every registered source declares reach, intent and at least one query', () => {
  for (const s of DEMAND_SOURCES) {
    assert.ok(Object.values(REACH).includes(s.reach), `${s.key} must declare a real reach`);
    assert.ok(Object.values(INTENT).includes(s.intent), `${s.key} must declare intent strength`);
    assert.ok(s.queries.length > 0, `${s.key} must declare what it looks for`);
    assert.ok(s.note && s.note.length > 20, `${s.key} must say why it is on the list`);
  }
});
