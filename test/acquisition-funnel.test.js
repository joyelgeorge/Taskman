import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIMARY_ACQUISITION_CHANNEL,
  FUNNEL_STAGES,
  recordProspect,
  advanceProspectStage,
  getFunnelMetrics,
  _resetAcquisitionFunnelState
} from '../src/acquisition-funnel.js';

test.beforeEach(() => {
  _resetAcquisitionFunnelState();
});

test('PRIMARY_ACQUISITION_CHANNEL defines selected channel, profile, and concrete outreach asset', () => {
  assert.equal(PRIMARY_ACQUISITION_CHANNEL.channelId, 'fiverr_community_and_subreddits_outbound');
  assert.ok(PRIMARY_ACQUISITION_CHANNEL.outreachAsset.headline.includes('Fiverr withdrawal'));
  assert.ok(PRIMARY_ACQUISITION_CHANNEL.outreachAsset.copy.includes('reconciliation tool'));
  assert.equal(FUNNEL_STAGES.length, 8);
  assert.ok(FUNNEL_STAGES.includes('DEMO_TRIAL'));
  assert.ok(FUNNEL_STAGES.includes('REFERRAL'));
});

test('recordProspect qualifies lead and initializes funnel stage', () => {
  const prospect = recordProspect({
    prospectId: 'prospect_agency_1',
    name: 'Pixelcraft Studio',
    monthlyVolumeCents: 450000, // $4,500/mo volume (qualifies)
    manualHoursMonthly: 6,
    referredBy: 'ref_agency_0'
  });

  assert.equal(prospect.prospectId, 'prospect_agency_1');
  assert.equal(prospect.stage, 'QUALIFIED');
  assert.equal(prospect.qualification.qualified, true);
  assert.equal(prospect.referredBy, 'ref_agency_0');
  assert.equal(prospect.history.length, 1);
});

test('advanceProspectStage transitions stages, accumulates CAC, payback and records objections', () => {
  recordProspect({
    prospectId: 'prospect_agency_2',
    name: 'Vortex Visuals',
    monthlyVolumeCents: 350000
  });

  // Advance to DEMO_TRIAL with objection
  const demo = advanceProspectStage({
    prospectId: 'prospect_agency_2',
    toStage: 'DEMO_TRIAL',
    timeSpentMinutes: 20,
    acquisitionCostCents: 200,
    objection: 'Prefers Excel macro over web tool',
    note: 'Completed 20min walkthrough demo'
  });

  assert.equal(demo.stage, 'DEMO_TRIAL');
  assert.equal(demo.timeSpentMinutes, 20);
  assert.equal(demo.acquisitionCostCents, 200);
  assert.equal(demo.objections.length, 1);
  assert.equal(demo.objections[0].objection, 'Prefers Excel macro over web tool');

  // Advance to PAID
  const paid = advanceProspectStage({
    prospectId: 'prospect_agency_2',
    toStage: 'PAID',
    timeSpentMinutes: 10,
    acquisitionCostCents: 300,
    revenueCollectedCents: 1900
  });

  assert.equal(paid.stage, 'PAID');
  assert.ok(paid.convertedAt);
  assert.equal(paid.timeSpentMinutes, 30);
  assert.equal(paid.acquisitionCostCents, 500);

  const metrics = getFunnelMetrics();
  assert.equal(metrics.totalProspects, 1);
  assert.equal(metrics.paidCount, 1);
  assert.equal(metrics.cacCents, 500); // $5.00 CAC
  assert.equal(metrics.conversionRate, '100.0%');
  assert.equal(metrics.paybackMonths, '0.3');
  assert.equal(metrics.recordedObjections.length, 1);
});
