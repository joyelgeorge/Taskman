import {
  recordAttempt, finishAttempt, recordSettlement,
  listAttempts, listSettlements, setRailState, getRailState,
  ATTEMPT_STATUS, SETTLEMENT_STATUS, VERIFIED_SOURCES
} from '../ledger.js';

/**
 * Marketplace orders fulfilled by hand — the Fiverr bookkeeping lane (#135),
 * and any later gig rail shaped the same way.
 *
 * Deliberately not a new table. An order already fits what the ledger models:
 * the work is a rail attempt (with the order's detail in its `evidence`), the
 * payout is a settlement. Adding an `orders` table would create a second place
 * money can be claimed, which is exactly what money-ledger.js exists to prevent.
 *
 * What this layer adds over calling the ledger directly is the one number that
 * decides whether a gig rail is worth continuing: effective hourly rate. A $15
 * order that takes three hours is a bad business, and cleared-per-attempt alone
 * cannot say so. `minutesSpent` is therefore required on every order — not
 * optional, not defaulted — because an unmeasured hour is how a rail stays
 * "profitable" on paper while losing.
 */

export const ORDER_STATUS = Object.freeze({
  IN_PROGRESS: 'IN_PROGRESS',
  DELIVERED: 'DELIVERED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED'
});

/** Registers a gig rail so the governor tracks it from its first order. */
export async function registerServiceRail(rail) {
  if (!rail) throw new Error('rail is required');
  const existing = await getRailState(rail);
  if (existing) return existing;
  return setRailState(rail, 'PROBATION');
}

/**
 * Records one marketplace order as a rail attempt.
 *
 * `costCents` is real cash spent fulfilling it (API calls, a paid tool) — not
 * the buyer's price, and not imputed labour. Time is tracked separately in
 * minutes so the two never get confused in the ledger's spend totals.
 */
export async function recordOrder({
  rail,
  orderId,
  marketplace = 'fiverr',
  priceCents,
  minutesSpent,
  costCents = 0,
  buyerHint = null,
  notes = null
}) {
  if (!rail) throw new Error('rail is required');
  if (!orderId) throw new Error('orderId is required — it is the payout\'s external reference later');
  if (!Number.isFinite(Number(priceCents)) || Number(priceCents) <= 0) {
    throw new Error('priceCents must be a positive amount');
  }
  if (!Number.isFinite(Number(minutesSpent)) || Number(minutesSpent) <= 0) {
    throw new Error('minutesSpent is required and must be positive — an unmeasured hour is how a rail looks profitable while losing');
  }

  await registerServiceRail(rail);

  return recordAttempt({
    rail,
    candidateKey: String(orderId),
    stage: 'FULFILL',
    costCents: Math.round(Number(costCents) || 0),
    evidence: {
      orderId: String(orderId),
      marketplace,
      priceCents: Math.round(Number(priceCents)),
      minutesSpent: Math.round(Number(minutesSpent)),
      buyerHint,
      notes,
      orderStatus: ORDER_STATUS.IN_PROGRESS
    }
  });
}

export async function markOrderDelivered(attemptId, { minutesSpent = null, notes = null } = {}) {
  const evidence = { orderStatus: ORDER_STATUS.DELIVERED };
  if (minutesSpent != null) evidence.minutesSpent = Math.round(Number(minutesSpent));
  if (notes != null) evidence.notes = notes;
  return finishAttempt(attemptId, { status: ATTEMPT_STATUS.DELIVERED, evidence });
}

/**
 * Records the payout for an order.
 *
 * Fiverr pays out via PayPal/Payoneer/bank, not Stripe, and only Stripe has an
 * automated verifier (packages/core/settlement-verifier.js). So the honest
 * source for a Fiverr payout is `manual_receipt` with the order ID as the
 * external reference — legitimate under the ledger's rules, and the weakest of
 * the three sources. That weakness is the reason the order ID is mandatory:
 * it is the one thing that can be checked back against the marketplace later.
 */
export async function recordOrderPayout({
  rail,
  orderId,
  attemptId = null,
  grossCents,
  feeCents = 0,
  source = 'manual_receipt',
  status = SETTLEMENT_STATUS.CLEARED,
  verification = {}
}) {
  if (!orderId) throw new Error('orderId is required');
  if (!VERIFIED_SOURCES.includes(source)) {
    throw new Error(`source must be one of ${VERIFIED_SOURCES.join(', ')}`);
  }
  return recordSettlement({
    rail,
    attemptId,
    source,
    externalRef: String(orderId),
    grossCents,
    feeCents,
    status,
    verification: { marketplace: 'fiverr', ...verification }
  });
}

export async function listOrders({ rail, limit = 100 } = {}) {
  const [attempts, settlements] = await Promise.all([
    listAttempts({ rail, limit }),
    listSettlements({ rail, limit })
  ]);
  const paidByOrderId = new Map(settlements.map(s => [s.externalRef, s]));

  return attempts
    .filter(a => a.evidence?.orderId)
    .map(a => {
      const settlement = paidByOrderId.get(a.evidence.orderId) || null;
      return {
        attemptId: a.id,
        rail: a.rail,
        orderId: a.evidence.orderId,
        marketplace: a.evidence.marketplace || null,
        priceCents: Number(a.evidence.priceCents || 0),
        minutesSpent: Number(a.evidence.minutesSpent || 0),
        costCents: a.costCents,
        buyerHint: a.evidence.buyerHint || null,
        notes: a.evidence.notes || null,
        orderStatus: settlement && settlement.status === SETTLEMENT_STATUS.CLEARED
          ? ORDER_STATUS.PAID
          : (a.evidence.orderStatus || ORDER_STATUS.IN_PROGRESS),
        startedAt: a.startedAt,
        payout: settlement && {
          netCents: settlement.netCents,
          source: settlement.source,
          status: settlement.status,
          verifiedAt: settlement.verifiedAt
        }
      };
    });
}

/**
 * The numbers that decide whether this gig is worth continuing.
 *
 * Only CLEARED payouts count toward earnings — same rule as everywhere else in
 * this system. Effective hourly rate is computed from cleared money over
 * measured minutes, so an order still awaiting payout drags the rate down
 * rather than flattering it.
 */
export async function orderEconomics({ rail } = {}) {
  const orders = await listOrders({ rail, limit: 1000 });
  const paid = orders.filter(o => o.payout && o.payout.status === SETTLEMENT_STATUS.CLEARED);

  const totalMinutes = orders.reduce((sum, o) => sum + o.minutesSpent, 0);
  const clearedCents = paid.reduce((sum, o) => sum + o.payout.netCents, 0);
  const cashCostCents = orders.reduce((sum, o) => sum + o.costCents, 0);
  const netCents = clearedCents - cashCostCents;

  return {
    rail,
    orders: orders.length,
    paidOrders: paid.length,
    awaitingPayout: orders.length - paid.length,
    totalMinutes,
    clearedCents,
    cashCostCents,
    netCents,
    avgOrderValueCents: paid.length ? Math.round(clearedCents / paid.length) : null,
    avgMinutesPerOrder: orders.length ? Math.round(totalMinutes / orders.length) : null,
    // The decisive number. Null rather than zero when nothing has cleared or no
    // time is logged — an undefined rate is not a rate of zero.
    effectiveHourlyRateCents: totalMinutes > 0 && clearedCents > 0
      ? Math.round(netCents / (totalMinutes / 60))
      : null
  };
}
