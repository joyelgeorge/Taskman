import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_TIERS,
  selectModelTier,
  evaluateEscalation,
  resolveProviderForTier,
  recordRoutingDecision,
  listRoutingDecisions,
  resetModelRouterMemory
} from '../src/model-router.js';

test('selectModelTier selects cheap tier for routine extraction and deterministic for normalization', () => {
  const norm = selectModelTier({ taskClass: 'normalization' });
  assert.equal(norm.tier, MODEL_TIERS.TIER_0);
  assert.equal(norm.estimatedCostCents, 0);

  const extract = selectModelTier({ taskClass: 'extraction' });
  assert.equal(extract.tier, MODEL_TIERS.TIER_1);

  const val = selectModelTier({ taskClass: 'adversarial_validation' });
  assert.equal(val.tier, MODEL_TIERS.TIER_2);
});

test('selectModelTier downscales when default tier exceeds maxCostCents ceiling', () => {
  const deep = selectModelTier({
    taskClass: 'deep_reasoning', // Default TIER_3 ($0.50 = 50 cents)
    maxCostCents: 20             // Bound to 20 cents
  });
  // Should downscale to TIER_2 (5 cents) or TIER_1
  assert.ok(deep.tier !== MODEL_TIERS.TIER_3);
  assert.ok(deep.estimatedCostCents <= 20);
});

test('evaluateEscalation forbids escalation based on low model confidence alone', () => {
  const res = evaluateEscalation({
    currentTier: MODEL_TIERS.TIER_1,
    failureReason: 'LOW_CONFIDENCE',
    selfReportedConfidence: 0.2
  });
  assert.equal(res.allowed, false);
  assert.ok(res.reason.includes('Model self-reported confidence alone cannot trigger'));
});

test('evaluateEscalation allows escalation on deterministic quality check failure when economically justified', () => {
  const res = evaluateEscalation({
    currentTier: MODEL_TIERS.TIER_1,
    failureReason: 'SCHEMA_PARSE_ERROR',
    estimatedValueCents: 500,
    maxCostCents: 50
  });
  assert.equal(res.allowed, true);
  assert.equal(res.nextTier, MODEL_TIERS.TIER_2);
});

test('evaluateEscalation denies escalation when job cost ceiling would be violated', () => {
  const res = evaluateEscalation({
    currentTier: MODEL_TIERS.TIER_2,
    failureReason: 'POST_CONDITION_FAILED',
    estimatedValueCents: 1000,
    maxCostCents: 10 // TIER_3 costs 50c, ceiling is 10c
  });
  assert.equal(res.allowed, false);
  assert.ok(res.reason.includes('exceeds job ceiling'));
});

test('recordRoutingDecision persists audit trail', async () => {
  resetModelRouterMemory();
  const rec = await recordRoutingDecision({
    taskClass: 'extraction',
    selectedTier: MODEL_TIERS.TIER_1,
    providerId: 'groq',
    modelId: 'llama-3.1-8b-instant',
    estimatedCostCents: 1
  });
  assert.ok(rec.id);
  assert.equal(rec.selectedTier, MODEL_TIERS.TIER_1);

  const list = await listRoutingDecisions();
  assert.equal(list.length, 1);
  assert.equal(list[0].providerId, 'groq');
});
