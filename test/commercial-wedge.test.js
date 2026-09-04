import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMERCIAL_WEDGE_SPEC,
  reconcileFiverrPayoutBatch
} from '../src/commercial-wedge.js';

test('COMMERCIAL_WEDGE_SPEC defines explicit customer, trigger, intervention, and kill criteria', () => {
  assert.equal(COMMERCIAL_WEDGE_SPEC.id, 'fiverr_bookkeeping_reconciliation_v1');
  assert.ok(COMMERCIAL_WEDGE_SPEC.customerType.includes('Fiverr'));
  assert.ok(COMMERCIAL_WEDGE_SPEC.measurableOutcome.includes('reconciliation'));
  assert.ok(COMMERCIAL_WEDGE_SPEC.killCriteria.includes('ROI'));
  assert.equal(COMMERCIAL_WEDGE_SPEC.status, 'ACTIVE_FOCUS');
});

test('reconcileFiverrPayoutBatch balances when deposits match net earnings exactly', () => {
  const transactions = [
    { grossAmount: 100.00, platformFee: 20.00 }, // net 80
    { grossAmount: 250.00, platformFee: 50.00 }  // net 200
  ];
  const deposits = [
    { amount: 280.00 }
  ];

  const result = reconcileFiverrPayoutBatch({ transactions, deposits });
  assert.equal(result.balanced, true);
  assert.equal(result.summary.grossEarningsCents, 35000);
  assert.equal(result.summary.platformFeesCents, 7000);
  assert.equal(result.summary.netWithdrawnCents, 28000);
  assert.equal(result.summary.bankDepositedCents, 28000);
  assert.equal(result.summary.taxDeductiblePlatformFees, '$70.00');
  assert.equal(result.discrepancies.length, 0);
});

test('reconcileFiverrPayoutBatch flags fee leakage or bank variance', () => {
  const transactions = [
    { grossAmount: 500.00, platformFee: 100.00 } // net 400
  ];
  // Bank deposit only received $385 (e.g. $15 wire or conversion fee leak)
  const deposits = [
    { amount: 385.00 }
  ];

  const result = reconcileFiverrPayoutBatch({ transactions, deposits });
  assert.equal(result.balanced, false);
  assert.equal(result.summary.deltaCents, 1500); // $15.00
  assert.equal(result.discrepancies.length, 1);
  assert.ok(result.discrepancies[0].description.includes('leakage of $15.00'));
});
