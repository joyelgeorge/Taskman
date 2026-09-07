import test from 'node:test';
import assert from 'node:assert/strict';
import { isNovel, toKey, EXPLORED_TERRITORIES, VERDICT } from '../packages/core/territory/registry.js';
import { scoreTerritory, rankTerritories } from '../packages/core/territory/scoring.js';

test('the registry records every explored lane with a verdict and a reason', () => {
  assert.ok(EXPLORED_TERRITORIES.length >= 8);
  for (const t of EXPLORED_TERRITORIES) {
    assert.ok(Object.values(VERDICT).includes(t.verdict));
    assert.ok(t.note && t.note.length > 20, `${t.key} states why`);
  }
});

test('a killed lane is not novel even renamed via an alias', () => {
  assert.equal(isNovel({ title: 'crypto micro-task farming', aliases: ['agent-economy-marketplaces'] }), false);
  assert.equal(isNovel({ title: 'defi yield bot', aliases: ['defi-arbitrage'] }), false);
});

test('an active lane is not novel when named directly or aliased', () => {
  assert.equal(isNovel({ title: 'oss-vuln-sweep' }), false);
  assert.equal(isNovel({ title: 'monthly audit rerun', aliases: ['audit-tool-contingency'] }), false);
});

test('a genuinely new territory with no matching alias is novel', () => {
  assert.equal(isNovel({ title: 'CWE regression test packs', aliases: [] }), true);
  assert.equal(isNovel({ title: 'honeypot eval dataset' }), true);
});

test('toKey normalises names so topical variants compare equal', () => {
  assert.equal(toKey('DeFi Arbitrage!'), 'defi-arbitrage');
});

test('only a genuinely closed rail caps the score; broad rails do not', () => {
  const r = scoreTerritory({ scores: {
    timeToFirstDollar: 'days', payoutReach: 'closed', feasibilityWithAssets: 'direct',
    saturation: 'underserved', distribution: 'buyers_already_searching'
  } });
  assert.ok(r.capped);
  assert.ok(r.score <= 0.2);

  // A card processor (Stripe/Wise/Payoneer) reaches most countries — viable,
  // not fatal. Lifting the old India assumption must not cap this.
  const card = scoreTerritory({ scores: {
    timeToFirstDollar: 'weeks', payoutReach: 'card_processor', feasibilityWithAssets: 'small_build',
    saturation: 'moderate', distribution: 'buyers_already_searching'
  } });
  assert.ok(!card.capped, 'card processor is not a fatal rail');
});

test('an unknown score label is treated pessimistically, not ignored', () => {
  const r = scoreTerritory({ scores: { timeToFirstDollar: 'someday' } });
  assert.equal(r.detail.timeToFirstDollar.value, 0.1);
});

test('rankTerritories sorts best-first and drops sub-floor candidates', () => {
  const good = { title: 'a', scores: { timeToFirstDollar: 'weeks', payoutReach: 'paypal_or_bank', feasibilityWithAssets: 'direct', saturation: 'underserved', distribution: 'buyers_already_searching' } };
  const weak = { title: 'b', scores: { timeToFirstDollar: 'unclear', payoutReach: 'closed', feasibilityWithAssets: 'none', saturation: 'swarmed', distribution: 'must_create_demand' } };
  const ranked = rankTerritories([weak, good]);
  assert.equal(ranked[0].title, 'a');
  assert.ok(!ranked.some((t) => t.title === 'b'), 'capped weak candidate dropped by floor');
});
