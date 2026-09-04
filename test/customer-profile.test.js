import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_PAYING_CUSTOMER_PROFILE,
  qualifyProspect
} from '../src/customer-profile.js';

test('FIRST_PAYING_CUSTOMER_PROFILE contains all required commercial parameters', () => {
  assert.ok(FIRST_PAYING_CUSTOMER_PROFILE.customerType.includes('agency'));
  assert.ok(FIRST_PAYING_CUSTOMER_PROFILE.decisionMakerRole.includes('Founder'));
  assert.equal(FIRST_PAYING_CUSTOMER_PROFILE.monthlyVolumeThresholdCents, 300000);
  assert.ok(FIRST_PAYING_CUSTOMER_PROFILE.buyingTriggers.length >= 3);
  assert.equal(FIRST_PAYING_CUSTOMER_PROFILE.prospectChannels.length, 10);
});

test('qualifyProspect qualifies high volume Fiverr agency owner with high ROI', () => {
  const result = qualifyProspect({
    monthlyVolumeCents: 500000, // $5,000 / mo
    platform: 'Fiverr Pro',
    manualHoursMonthly: 6,
    strugglesWithDiscrepancies: true
  });

  assert.equal(result.qualified, true);
  assert.ok(result.qualificationScore >= 80);
  assert.equal(result.targetTier, 'PRO_AGENCY');
  assert.ok(result.estimatedAnnualSavingsCents > 100000);
  assert.ok(result.recommendation.includes('High priority prospect'));
});

test('qualifyProspect routes sub-threshold or non-Fiverr prospect to pay-per-batch option', () => {
  const result = qualifyProspect({
    monthlyVolumeCents: 50000, // $500 / mo (below $3k)
    platform: 'Fiverr',
    manualHoursMonthly: 1,
    strugglesWithDiscrepancies: false
  });

  assert.equal(result.qualified, false);
  assert.equal(result.targetTier, 'STANDARD_FREELANCER');
  assert.ok(result.recommendation.includes('Below volume threshold'));
});
