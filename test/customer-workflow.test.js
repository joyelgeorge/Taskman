import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCustomerWorkflowState,
  configureCustomerWorkflow,
  setCustomerIntegration,
  setCustomerWorkflowActive,
  executeCustomerReconciliation,
  confirmCustomerOutcome,
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
  assert.equal(updated.economicTaxonomy.estimatedSavingsCents, updated.valueMetrics.estimatedAnnualSavingsCents);
  // Verified cash recovered and confirmed savings must remain 0
  assert.equal(updated.valueMetrics.verifiedCashRecoveredCents, 0);
  assert.equal(updated.economicTaxonomy.verifiedCashRecoveredCents, 0);
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

test('executeCustomerReconciliation categorizes platform fees without fabricating recovered cash', () => {
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
  // Reconciled platform fees are tracked
  assert.equal(state.valueMetrics.reconciledPlatformFeesCents, 30000);
  assert.equal(state.economicTaxonomy.categorizedPlatformFeesCents, 30000);
  assert.equal(state.economicTaxonomy.reconciledAmountCents, 150000);
  assert.equal(state.economicTaxonomy.identifiedDiscrepancyCents, 0);

  // CRITICAL DEFECT FIX: verifiedCashRecoveredCents and confirmed savings must be 0!
  assert.equal(state.valueMetrics.verifiedCashRecoveredCents, 0);
  assert.equal(state.economicTaxonomy.verifiedCashRecoveredCents, 0);
  assert.equal(state.economicTaxonomy.customerConfirmedSavingsCents, 0);

  assert.equal(state.valueMetrics.reconciliationCount, 1);
  assert.ok(state.valueMetrics.lastVerifiedEvidenceRef.startsWith('fiverr-recon-'));
  assert.equal(state.reconciliationHistory.length, 1);
});

test('confirmCustomerOutcome establishes immutable cryptographic audit binding', () => {
  configureCustomerWorkflow({
    agencyName: 'Apex Creative Studio',
    fiverrUsername: 'apexpro'
  });
  setCustomerIntegration({ integration: 'fiverrStatements', connected: true });
  setCustomerWorkflowActive(true);

  const { state: reconState } = executeCustomerReconciliation({
    transactions: [{ grossAmount: 1000.00, platformFee: 200.00 }],
    deposits: [{ amount: 800.00 }]
  });

  const runId = reconState.reconciliationHistory[0].id;

  const { confirmation, state: confirmedState } = confirmCustomerOutcome({
    runId,
    outcomeType: 'CONFIRMED_TAX_DEDUCTION',
    confirmedAmountCents: 20000,
    actor: 'cpa_auditor@apex.com',
    reason: 'Verified and applied as allowable platform expense on Form 1040 Schedule C'
  });

  assert.ok(confirmation.confirmationId.startsWith('conf_'));
  assert.equal(confirmation.runId, runId);
  assert.equal(confirmation.confirmedAmountCents, 20000);
  assert.equal(confirmation.outcomeType, 'CONFIRMED_TAX_DEDUCTION');
  assert.equal(confirmedState.economicTaxonomy.customerConfirmedSavingsCents, 20000);
  assert.equal(confirmedState.valueMetrics.customerConfirmedSavingsCents, 20000);
  assert.equal(confirmedState.confirmedOutcomes.length, 1);
});
