import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contingencyFee, worthBilling, MARKET_CONTINGENCY_RATES, DEFAULT_CONTINGENCY_PERCENT
} from '../income/pricing.js';
import { PAYOUT_COST } from '../income/venues.js';

test('the rate is anchored to what comparable firms charge, not invented', () => {
  // TrueOps 10, Helium 10 ~16.5, Refully 18, GETIDA 25, Seller Investigators 25,
  // SellerVault ~17.5. An entire industry converged on contingency; the default
  // sits inside that band rather than beside it.
  const rates = MARKET_CONTINGENCY_RATES.map(r => r.percent);
  assert.ok(DEFAULT_CONTINGENCY_PERCENT >= Math.min(...rates));
  assert.ok(DEFAULT_CONTINGENCY_PERCENT <= Math.max(...rates));
});

test('nothing recovered means nothing owed, which is the whole offer', () => {
  const fee = contingencyFee({ confirmedRecoveredCents: 0 });
  assert.equal(fee.billableCents, 0);
  assert.match(fee.reason, /nothing is owed/);
});

test('the fee is charged on the confirmed recovery, never on the finding', () => {
  // A finding is a question to ask the platform. Only the customer can say what
  // actually came back, and billing the finding is how this turns into a dispute.
  const fee = contingencyFee({ confirmedRecoveredCents: 286_200, percent: 20 });
  assert.equal(fee.billableCents, 57_240);
  assert.equal(fee.confirmedRecoveredCents, 286_200);
});

test('a rate outside what the market charges is refused', () => {
  assert.throws(() => contingencyFee({ confirmedRecoveredCents: 10_000, percent: 45 }),
    /between 0 and 30/);
});

test('contingency makes the payment rail stop mattering', () => {
  // The rail problem is a small-ticket problem. PayPal India takes 9.4% of a $20
  // flat fee; on a $572 contingency fee for the same work it takes 8% of a much
  // larger number, and the fee stops being the constraint.
  const flat = contingencyFee({ confirmedRecoveredCents: 10_000, percent: 20, railCost: PAYOUT_COST['paypal:IN'] });
  const real = contingencyFee({ confirmedRecoveredCents: 286_200, percent: 20, railCost: PAYOUT_COST['paypal:IN'] });
  assert.ok(real.netCents > flat.netCents * 20);
  assert.ok(real.railTakeOfFeePct < flat.railTakeOfFeePct);
});

test('a finding too small to bill is given away rather than invoiced', () => {
  const small = worthBilling({ confirmedRecoveredCents: 2000 });
  assert.equal(small.bill, false);
  assert.match(small.reason, /give the finding away/);
  assert.equal(worthBilling({ confirmedRecoveredCents: 100_000 }).bill, true);
});
