import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerPayoutLeakageRail,
  getPayoutLeakageRail,
  listPayoutLeakageRails,
  recordLeakageIncident,
  advanceLeakageIncidentStage,
  getLeakageIncident,
  LEAKAGE_DISCREPANCY_TYPE,
  LEAKAGE_LIFECYCLE_STAGE,
  resetPayoutLeakagePlatformMemory
} from '../src/payout-leakage-platform.js';

test('registerPayoutLeakageRail enforces declared settlement source and kill budget', () => {
  resetPayoutLeakagePlatformMemory();

  // Missing kill budget or settlement source throws
  assert.throws(() => registerPayoutLeakageRail({ railKey: 'bad' }), /Rail requires/);

  const upworkRail = registerPayoutLeakageRail({
    railKey: 'upwork_escrow_leakage',
    name: 'Upwork Escrow & Fee Variance Rail',
    sourceFamily: 'freelance_marketplace',
    source: 'upwork_transaction_history_csv',
    settlementSource: 'bank_statement',
    deterministicTrigger: 'withdrawal_fee_exceeds_published_rate',
    killBudgetCents: 5000
  });

  const stripeRail = registerPayoutLeakageRail({
    railKey: 'stripe_connect_fx_leakage',
    name: 'Stripe Connect Payout FX Variance',
    sourceFamily: 'payment_gateway',
    source: 'stripe_balance_transactions',
    settlementSource: 'bank_statement',
    deterministicTrigger: 'fx_rate_exceeds_market_spread_by_2pct',
    killBudgetCents: 5000
  });

  assert.equal(upworkRail.railKey, 'upwork_escrow_leakage');
  assert.equal(stripeRail.railKey, 'stripe_connect_fx_leakage');
  assert.equal(listPayoutLeakageRails().length, 2);
});

test('recordLeakageIncident separates detected from recovered cash across lifecycle stages', () => {
  resetPayoutLeakagePlatformMemory();

  registerPayoutLeakageRail({
    railKey: 'upwork_escrow_leakage',
    source: 'upwork_csv',
    settlementSource: 'bank',
    deterministicTrigger: 'escrow_variance',
    killBudgetCents: 5000
  });

  const inc = recordLeakageIncident({
    railKey: 'upwork_escrow_leakage',
    customerId: 'cust-123',
    discrepancyType: LEAKAGE_DISCREPANCY_TYPE.UNEXPLAINED_FEE_VARIANCE,
    detectedAmountCents: 15000, // $150.00 detected
    evidenceRefs: ['upwork_csv_row_42']
  });

  assert.equal(inc.stage, LEAKAGE_LIFECYCLE_STAGE.DETECTED);
  assert.equal(inc.detectedAmountCents, 15000);
  assert.equal(inc.verifiedCashRecoveredCents, 0, 'Detected discrepancy is NOT cash recovered');

  // Customer acknowledges
  advanceLeakageIncidentStage(inc.id, LEAKAGE_LIFECYCLE_STAGE.CUSTOMER_ACKNOWLEDGED, {
    amountCents: 15000
  });
  assert.equal(inc.customerAcknowledgedAmountCents, 15000);
  assert.equal(inc.verifiedCashRecoveredCents, 0);

  // Intervention accepted & Cash received from platform refund
  advanceLeakageIncidentStage(inc.id, LEAKAGE_LIFECYCLE_STAGE.CASH_RECEIVED, {
    amountCents: 15000,
    evidenceRef: 'bank_deposit_txn_999'
  });
  assert.equal(inc.verifiedCashRecoveredCents, 15000);
  assert.equal(inc.evidenceRefs.length, 2);

  // Fee charged (e.g. 15% recovery fee = $22.50 = 2250 cents)
  advanceLeakageIncidentStage(inc.id, LEAKAGE_LIFECYCLE_STAGE.FEE_CHARGED, {
    amountCents: 2250
  });
  assert.equal(inc.feeChargedCents, 2250);

  // Cash collected
  advanceLeakageIncidentStage(inc.id, LEAKAGE_LIFECYCLE_STAGE.CASH_COLLECTED, {
    amountCents: 2250
  });
  assert.equal(inc.cashCollectedCents, 2250);
});
