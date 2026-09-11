import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE_TIER, classifyEvidenceTier, hasVerifiableReference,
  normalizeCandidate, assertSpendAllowed, assertClaimAllowed
} from '../src/evidence-tier.js';

/**
 * The rule these tests pin: a reference gates ASSERTION and SPEND, never
 * EXPLORATION. A brand-new idea with no reference must still be able to enter
 * the pipeline — it just may not claim precision it has not earned.
 */

// ---- exploration is never blocked ----

test('a brand-new idea with no reference is still a valid candidate', () => {
  const { candidate, tier, rejected } = normalizeCandidate({
    id: 'new-idea', title: 'Securing vibe-coded Supabase apps'
  });
  assert.equal(rejected, false, 'exploration must never be rejected');
  assert.equal(tier, EVIDENCE_TIER.HYPOTHESIS);
  assert.equal(candidate.id, 'new-idea');
});

test('an unexplored hypothesis is routed to investigation, not to skip', () => {
  const { decision } = normalizeCandidate({ id: 'x', title: 'Unknown territory' });
  assert.equal(decision, 'NEEDS_EVIDENCE');
});

// ---- what counts as a reference ----

test('a live listing URL is a reference', () => {
  assert.equal(hasVerifiableReference({ sourceUrl: 'https://algora.io/bounties/123' }).ok, true);
});

test('a demand signal URL counts too — novelty must not be penalised', () => {
  // A reddit thread is a checkable external artifact. Requiring a *bounty
  // listing* specifically would confine the engine to picked-clean boards.
  assert.equal(hasVerifiableReference({ sourceUrl: 'https://reddit.com/r/Fiverr/comments/abc' }).ok, true);
});

test('an externalRef counts', () => {
  assert.equal(hasVerifiableReference({ externalRef: 'ORDER-99120' }).ok, true);
});

test('a generic source label is NOT a reference', () => {
  const r = hasVerifiableReference({ source: 'Algora / GitHub OSS Bounty' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /generic|label|not a reference/i);
});

test('a non-http string is not a reference', () => {
  assert.equal(hasVerifiableReference({ sourceUrl: 'internal-feed' }).ok, false);
});

// ---- unearned precision is stripped, not rejected ----

test('a hypothesis may not assert escrow', () => {
  const { candidate, stripped } = normalizeCandidate({
    id: 'h', title: 'Maybe', escrow: true, rewardDollars: 150, pSuccess: 0.95
  });
  assert.equal(candidate.escrow, null);
  assert.ok(stripped.includes('escrow'));
});

test('a hypothesis may not assert a precise reward or probability', () => {
  const { candidate, stripped } = normalizeCandidate({
    id: 'h', title: 'Maybe', escrow: true, rewardDollars: 150, pSuccess: 0.95
  });
  assert.equal(candidate.rewardDollars, null);
  assert.equal(candidate.pSuccess, null);
  assert.ok(stripped.includes('rewardDollars'));
  assert.ok(stripped.includes('pSuccess'));
});

test('the unverified estimate survives, clearly labelled', () => {
  const { candidate } = normalizeCandidate({ id: 'h', title: 'Maybe', rewardDollars: 150 });
  assert.equal(candidate.unverifiedRewardEstimateDollars, 150,
    'the number is kept as an estimate, not destroyed');
  assert.equal(candidate.rewardBasis, 'unverified_estimate');
});

test('a referenced candidate keeps its precision', () => {
  const { candidate, tier, stripped } = normalizeCandidate({
    id: 'r', title: 'Real', sourceUrl: 'https://algora.io/bounties/7',
    escrow: true, rewardDollars: 150, pSuccess: 0.9
  });
  assert.equal(tier, EVIDENCE_TIER.REFERENCED);
  assert.equal(candidate.escrow, true);
  assert.equal(candidate.rewardDollars, 150);
  assert.deepEqual(stripped, []);
});

test('classification is driven by reference, never by novelty', () => {
  const novelWithRef = { id: 'n', title: 'Never tried', sourceUrl: 'https://example.com/thread/1' };
  const familiarNoRef = { id: 'f', title: 'Algora bounty', source: 'Algora / GitHub OSS Bounty' };
  assert.equal(classifyEvidenceTier(novelWithRef), EVIDENCE_TIER.REFERENCED);
  assert.equal(classifyEvidenceTier(familiarNoRef), EVIDENCE_TIER.HYPOTHESIS);
});

// ---- spend and claims are gated; exploration is not ----

test('a hypothesis may be investigated at zero cost', () => {
  assert.doesNotThrow(() => assertSpendAllowed({ id: 'h' }, { costCents: 0 }));
});

test('a hypothesis may NOT incur real spend', () => {
  assert.throws(() => assertSpendAllowed({ id: 'h' }, { costCents: 500 }), /reference/i);
});

test('a referenced candidate may spend', () => {
  assert.doesNotThrow(() =>
    assertSpendAllowed({ id: 'r', sourceUrl: 'https://algora.io/b/1' }, { costCents: 500 }));
});

test('a hypothesis may not be claimed DELIVERED', () => {
  assert.throws(() => assertClaimAllowed({ id: 'h' }, 'DELIVERED'), /reference/i);
});

test('a hypothesis may not be claimed CLEARED', () => {
  assert.throws(() => assertClaimAllowed({ id: 'h' }, 'CLEARED'), /reference/i);
});

test('a hypothesis MAY be marked NEEDS_EVIDENCE or PENDING', () => {
  assert.doesNotThrow(() => assertClaimAllowed({ id: 'h' }, 'NEEDS_EVIDENCE'));
  assert.doesNotThrow(() => assertClaimAllowed({ id: 'h' }, 'PENDING_IMPLEMENTATION'));
});

test('TESTED_AND_READY needs no counterparty reference — its evidence is internal', () => {
  // The test run itself is the evidence. Gating this on an external reference
  // would block finishing work on an unexplored lane before anyone is shown it.
  assert.doesNotThrow(() => assertClaimAllowed({ id: 'h' }, 'TESTED_AND_READY'));
});

test('but showing it to a counterparty still needs one', () => {
  assert.throws(() => assertClaimAllowed({ id: 'h' }, 'DELIVERED'), /reference/i);
});
