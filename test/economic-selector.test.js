import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  ECONOMIC_DECISION,
  calculateExpectedNetValue,
  handleEconomicSelectorRequest,
  rankEconomicOpportunities,
  scoreEconomicOpportunity
} from '../src/economic-selector.js';

const NOW = Date.parse('2026-09-01T07:00:00.000Z');
const EVIDENCE = Object.freeze({
  pEligible: 'qualification:eligible:v1',
  pClaim: 'rail:claim-rate:2026-08',
  pAccept: 'rail:accept-rate:2026-08',
  pPayout: 'rail:payout-rate:2026-08'
});

function opportunity(overrides = {}) {
  return {
    id: 'candidate-1', rail: 'test-rail', reward: 10, workerShare: 0.5,
    upfrontFee: 0.1, aiCost: 0.2, platformFee: 0.1, riskReserve: 0.1,
    pEligible: 1, pClaim: 0.8, pAccept: 0.5, pPayout: 0.9,
    probabilityEvidence: EVIDENCE, observedAt: '2026-09-01T06:59:00.000Z',
    requiredCapabilities: ['rail.test-rail.read'], ...overrides
  };
}

const CAPABILITIES = { 'rail.test-rail.read': { status: 'available' } };

test('calculates exact deterministic EV from evidence-bound inputs', () => {
  const input = opportunity();
  const first = calculateExpectedNetValue({ grossReward: input.reward, workerShare: input.workerShare,
    upfrontFee: input.upfrontFee, aiToolCost: input.aiCost, platformFee: input.platformFee,
    riskReserve: input.riskReserve, pEligible: input.pEligible, pClaim: input.pClaim,
    pAccept: input.pAccept, pPayout: input.pPayout, probabilityEvidence: EVIDENCE });
  const second = calculateExpectedNetValue({ grossReward: input.reward, workerShare: input.workerShare,
    upfrontFee: input.upfrontFee, aiToolCost: input.aiCost, platformFee: input.platformFee,
    riskReserve: input.riskReserve, pEligible: input.pEligible, pClaim: input.pClaim,
    pAccept: input.pAccept, pPayout: input.pPayout, probabilityEvidence: EVIDENCE });
  assert.deepEqual(first, second);
  assert.equal(first.grossExpectedValue, 1.8);
  assert.equal(first.expectedNetValue, 1.3);
  assert.equal(first.realizedValue, null);
  assert.equal(first.verifiedRevenue, null);
  assert.equal('calculatedAt' in first, false);
});

test('preserves an explicit zero worker share', () => {
  const result = calculateExpectedNetValue({ grossReward: 100, workerShare: 0,
    pEligible: 1, pClaim: 1, pAccept: 1, pPayout: 1, probabilityEvidence: EVIDENCE });
  assert.equal(result.workerShare, 0);
  assert.equal(result.expectedNetValue, 0);
});

test('rejects negative, non-finite, and out-of-range economic facts', () => {
  for (const input of [
    { grossReward: -1 }, { upfrontFee: -1 }, { aiToolCost: Number.NaN },
    { pAccept: 1.1 }, { workerShare: -0.1 }
  ]) assert.throws(() => calculateExpectedNetValue({ ...opportunity(), ...input }), /Invalid request/);
});

test('missing probability values or citations never receive invented priors', () => {
  const missingValue = scoreEconomicOpportunity(opportunity({ pAccept: undefined }), { capabilities: CAPABILITIES, nowMs: NOW });
  const missingCitation = scoreEconomicOpportunity(opportunity({ probabilityEvidence: { ...EVIDENCE, pPayout: '' } }), { capabilities: CAPABILITIES, nowMs: NOW });
  assert.equal(missingValue.decision, ECONOMIC_DECISION.NEEDS_EVIDENCE);
  assert.deepEqual(missingValue.ev.missingEvidence, ['pAccept']);
  assert.equal(missingCitation.decision, ECONOMIC_DECISION.NEEDS_EVIDENCE);
  assert.deepEqual(missingCitation.ev.missingEvidence, ['pPayout']);
});

test('model confidence cannot substitute for payout probability evidence', () => {
  const scored = scoreEconomicOpportunity(opportunity({ pPayout: undefined, modelConfidence: 0.999 }), { capabilities: CAPABILITIES, nowMs: NOW });
  assert.equal(scored.decision, ECONOMIC_DECISION.NEEDS_EVIDENCE);
  assert.equal(scored.ev.probabilities.pPayout, 0);
});

test('stale, future, and missing observation timestamps cannot authorize entry', () => {
  for (const observedAt of ['2026-09-01T06:00:00.000Z', '2026-09-01T07:01:00.000Z', undefined]) {
    const scored = scoreEconomicOpportunity(opportunity({ observedAt }), { capabilities: CAPABILITIES, nowMs: NOW });
    assert.equal(scored.decision, ECONOMIC_DECISION.NEEDS_EVIDENCE);
    assert.equal(scored.evidenceFresh, false);
  }
});

test('authoritative capability state blocks or requests setup before economics', () => {
  const blocked = scoreEconomicOpportunity(opportunity(), { capabilities: {}, nowMs: NOW });
  const setup = scoreEconomicOpportunity(opportunity(), {
    capabilities: { 'rail.test-rail.read': { status: 'setup_required' } }, nowMs: NOW
  });
  assert.equal(blocked.decision, ECONOMIC_DECISION.BLOCKED);
  assert.equal(setup.decision, ECONOMIC_DECISION.SETUP_REQUIRED);
});

test('closed and sub-threshold opportunities are skipped', () => {
  assert.equal(scoreEconomicOpportunity(opportunity({ isOpen: false }), { capabilities: CAPABILITIES, nowMs: NOW }).decision, ECONOMIC_DECISION.SKIP);
  assert.equal(scoreEconomicOpportunity(opportunity({ reward: 0 }), { capabilities: CAPABILITIES, nowMs: NOW }).decision, ECONOMIC_DECISION.SKIP);
});

test('positive EV is recommendation-only and never authorizes spend or execution', () => {
  const scored = scoreEconomicOpportunity(opportunity({ maxSpendAuthorized: 1_000_000 }), { capabilities: CAPABILITIES, nowMs: NOW });
  assert.equal(scored.decision, ECONOMIC_DECISION.ENTER);
  assert.equal(scored.executionAuthorized, false);
  assert.equal(scored.spendAuthorized, false);
  assert.equal(scored.requiresSeparateSpendAuthorization, true);
});

test('cross-rail ranking is deterministic for decisions, EV, rail, and id ties', () => {
  const ranked = rankEconomicOpportunities([
    opportunity({ id: 'b', rail: 'z' }),
    opportunity({ id: 'a', rail: 'a' }),
    opportunity({ id: 'high', rail: 'x', reward: 20 }),
    opportunity({ id: 'stale', observedAt: '2020-01-01T00:00:00.000Z', reward: 1_000 })
  ], { capabilities: CAPABILITIES, nowMs: NOW });
  assert.deepEqual(ranked.map(item => item.id), ['high', 'a', 'b', 'stale']);
});

test('rank input is bounded', () => {
  assert.throws(() => rankEconomicOpportunities(new Array(1_001).fill(opportunity())), /Invalid request/);
});

function request(body) {
  const serialized = JSON.stringify(body);
  const req = Readable.from([serialized]);
  req.method = 'POST';
  req.headers = { 'content-length': String(Buffer.byteLength(serialized)) };
  return req;
}

function response() {
  return {
    status: null, headers: null, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = JSON.parse(body); }
  };
}

test('HTTP score route ignores caller capability assertions and remains read-only', async () => {
  const req = request({ opportunity: opportunity({ observedAt: new Date().toISOString() }), capabilities: CAPABILITIES, maxSpendAuthorized: 1_000_000 });
  const res = response();
  const handled = await handleEconomicSelectorRequest(req, res, new URL('http://localhost/api/economic-selector/score'), {
    capabilityRegistry: {}
  });
  assert.equal(handled, true);
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, ECONOMIC_DECISION.BLOCKED);
  assert.equal(res.body.executionAuthorized, false);
  assert.equal(res.body.verifiedRevenue, undefined);
  assert.equal(res.body.ev.verifiedRevenue, null);
});

test('HTTP rank route uses only the internally supplied capability registry', async () => {
  const req = request({ opportunities: [opportunity({ id: 'one', observedAt: new Date().toISOString() })], capabilities: {} });
  const res = response();
  await handleEconomicSelectorRequest(req, res, new URL('http://localhost/api/economic-selector/rank'), {
    capabilityRegistry: CAPABILITIES
  });
  assert.equal(res.status, 200);
  assert.equal(res.body[0].id, 'one');
  assert.equal(res.body[0].decision, ECONOMIC_DECISION.ENTER);
});
