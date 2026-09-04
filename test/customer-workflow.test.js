import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCustomerWorkflowState,
  configureCustomerWorkflow,
  setCustomerIntegration,
  setCustomerWorkflowActive,
  executeCustomerReconciliation,
  _resetCustomerWorkflowState
} from '../src/customer-workflow.js';

test.beforeEach(() => {
  _resetCustomerWorkflowState();
});

test('getCustomerWorkflowState provides clear blockers before configuration and integration', () => {
  const state = getCustomerWorkflowState();
  assert.equal(state.status, 'INACTIVE');
  assert.equal(state.canActivate, false);
  assert.ok(state.blockers.length >= 2);
  assert.ok(state.blockers.some(b => b.includes('Agency & Fiverr profile setup incomplete')));
  assert.ok(state.blockers.some(b => b.includes('Fiverr transaction statement source not connected')));
});

test('configureCustomerWorkflow updates customer profile and calculates unverified estimated savings', () => {
  const updated = configureCustomerWorkflow({
    agencyName: 'Apex Creative Studio',
    fiverrUsername: 'apexpro',
    monthlyVolumeEstimate: 6000
  });

  assert.equal(updated.configuredInputs.agencyName, 'Apex Creative Studio');
  assert.equal(updated.configuredInputs.fiverrUsername, 'apexpro');
  assert.ok(updated.valueMetrics.estimatedAnnualSavingsCents > 0);
  // Verified savings must remain 0
  assert.equal(updated.valueMetrics.verifiedRecoveredFeesCents, 0);
});

test('workflow cannot be activated until blockers are resolved', () => {
  assert.throws(() => {
    setCustomerWorkflowActive(true);
  }, /Cannot activate workflow while blockers exist/);

  // Configure profile
  configureCustomerWorkflow({
    agencyName: 'Apex Creative Studio',
    fiverrUsername: 'apexpro'
  });

  // Still cannot activate because statements integration is not connected
  assert.throws(() => {
    setCustomerWorkflowActive(true);
  }, /Cannot activate workflow while blockers exist/);

  // Connect statement integration
  setCustomerIntegration({ integration: 'fiverrStatements', connected: true });

  const state = setCustomerWorkflowActive(true);
  assert.equal(state.status, 'ACTIVE');
  assert.ok(state.activatedAt);
});

test('executeCustomerReconciliation verifies real economic value and logs audit evidence', () => {
  configureCustomerWorkflow({
    agencyName: 'Apex Creative Studio',
    fiverrUsername: 'apexpro'
  });
  setCustomerIntegration({ integration: 'fiverrStatements', connected: true });
  setCustomerWorkflowActive(true);

  const transactions = [
    { grossAmount: 1000.00, platformFee: 200.00 }, // net 800
    { grossAmount: 500.00, platformFee: 100.00 }   // net 400
  ];
  const deposits = [
    { amount: 1200.00 }
  ];

  const { report, state } = executeCustomerReconciliation({ transactions, deposits });

  assert.equal(report.balanced, true);
  assert.equal(state.valueMetrics.verifiedRecoveredFeesCents, 30000); // $300.00 platform fees verified
  assert.equal(state.valueMetrics.verifiedReconciliationCount, 1);
  assert.ok(state.valueMetrics.lastVerifiedEvidenceRef.startsWith('fiverr-recon-'));
  assert.equal(state.reconciliationHistory.length, 1);
  assert.equal(state.reconciliationHistory[0].verifiedTaxFeeSavingsCents, 30000);
});
