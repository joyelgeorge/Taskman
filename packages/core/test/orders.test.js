import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordOrder, markOrderDelivered, recordOrderPayout, listOrders, orderEconomics,
  registerServiceRail, ORDER_STATUS
} from '../orders/index.js';
import { getRailState, resetLedgerMemory, resetGovernorMemory, SETTLEMENT_STATUS } from '../ledger.js';

const RAIL = 'fiverr-bookkeeping';
function reset() { resetLedgerMemory(); resetGovernorMemory(); }

test('registering a gig rail puts it on probation so the governor tracks it', async () => {
  reset();
  await registerServiceRail(RAIL);
  const state = await getRailState(RAIL);
  assert.equal(state.state, 'PROBATION');
});

test('an order without measured time is rejected outright', async () => {
  reset();
  await assert.rejects(
    () => recordOrder({ rail: RAIL, orderId: 'FO123', priceCents: 1500 }),
    /minutesSpent is required/
  );
});

test('an order without an order id is rejected — it is the payout reference later', async () => {
  reset();
  await assert.rejects(
    () => recordOrder({ rail: RAIL, priceCents: 1500, minutesSpent: 30 }),
    /orderId is required/
  );
});

test('a recorded order shows up with its detail and no payout yet', async () => {
  reset();
  await recordOrder({ rail: RAIL, orderId: 'FO123', priceCents: 1500, minutesSpent: 45, costCents: 20, notes: 'Shopify reconcile' });

  const [order] = await listOrders({ rail: RAIL });
  assert.equal(order.orderId, 'FO123');
  assert.equal(order.priceCents, 1500);
  assert.equal(order.minutesSpent, 45);
  assert.equal(order.costCents, 20);
  assert.equal(order.orderStatus, ORDER_STATUS.IN_PROGRESS);
  assert.equal(order.payout, null);
});

test('the buyer price is never treated as revenue until a payout clears', async () => {
  reset();
  await recordOrder({ rail: RAIL, orderId: 'FO123', priceCents: 5000, minutesSpent: 60 });

  const economics = await orderEconomics({ rail: RAIL });
  assert.equal(economics.clearedCents, 0, 'a $50 order price is not $50 earned');
  assert.equal(economics.awaitingPayout, 1);
  assert.equal(economics.effectiveHourlyRateCents, null, 'no cleared money means no rate, not a rate of zero');
});

test('a cleared payout produces a real effective hourly rate', async () => {
  reset();
  // One order: $20 gross, $4 platform fee, 30 minutes of work, $1 of API cost.
  await recordOrder({ rail: RAIL, orderId: 'FO200', priceCents: 2000, minutesSpent: 30, costCents: 100 });
  await recordOrderPayout({ rail: RAIL, orderId: 'FO200', grossCents: 2000, feeCents: 400, status: SETTLEMENT_STATUS.CLEARED });

  const economics = await orderEconomics({ rail: RAIL });
  assert.equal(economics.clearedCents, 1600); // 2000 - 400 fee
  assert.equal(economics.cashCostCents, 100);
  assert.equal(economics.netCents, 1500);
  // $15.00 net over half an hour = $30.00/hour
  assert.equal(economics.effectiveHourlyRateCents, 3000);
  assert.equal(economics.paidOrders, 1);
});

test('a slow job and a fast job at the same price produce very different hourly rates', async () => {
  reset();
  await recordOrder({ rail: RAIL, orderId: 'FAST', priceCents: 2000, minutesSpent: 20 });
  await recordOrderPayout({ rail: RAIL, orderId: 'FAST', grossCents: 2000, status: SETTLEMENT_STATUS.CLEARED });
  const fast = await orderEconomics({ rail: RAIL });

  reset();
  await recordOrder({ rail: RAIL, orderId: 'SLOW', priceCents: 2000, minutesSpent: 180 });
  await recordOrderPayout({ rail: RAIL, orderId: 'SLOW', grossCents: 2000, status: SETTLEMENT_STATUS.CLEARED });
  const slow = await orderEconomics({ rail: RAIL });

  assert.equal(fast.effectiveHourlyRateCents, 6000); // $20 over 20min
  assert.equal(slow.effectiveHourlyRateCents, 667);  // $20 over 3h
  assert.ok(fast.effectiveHourlyRateCents > slow.effectiveHourlyRateCents * 5,
    'the metric that decides whether this gig is worth continuing has to separate these two');
});

test('a paid order reads as PAID, and the order id is the settlement reference', async () => {
  reset();
  await recordOrder({ rail: RAIL, orderId: 'FO300', priceCents: 1000, minutesSpent: 15 });
  await recordOrderPayout({ rail: RAIL, orderId: 'FO300', grossCents: 1000, status: SETTLEMENT_STATUS.CLEARED });

  const [order] = await listOrders({ rail: RAIL });
  assert.equal(order.orderStatus, ORDER_STATUS.PAID);
  assert.equal(order.payout.netCents, 1000);
  assert.equal(order.payout.source, 'manual_receipt');
});

test('a payout defaults to manual_receipt and rejects an unverifiable source', async () => {
  reset();
  await recordOrder({ rail: RAIL, orderId: 'FO400', priceCents: 1000, minutesSpent: 10 });
  await assert.rejects(
    () => recordOrderPayout({ rail: RAIL, orderId: 'FO400', grossCents: 1000, source: 'vibes' }),
    /source must be one of/
  );
});

test('marking an order delivered can correct the time it actually took', async () => {
  reset();
  const attempt = await recordOrder({ rail: RAIL, orderId: 'FO500', priceCents: 1000, minutesSpent: 15 });
  await markOrderDelivered(attempt.id, { minutesSpent: 90, notes: 'took far longer than quoted' });

  const [order] = await listOrders({ rail: RAIL });
  assert.equal(order.minutesSpent, 90);
  assert.equal(order.orderStatus, ORDER_STATUS.DELIVERED);
});
