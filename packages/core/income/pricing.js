/**
 * How the work is priced, which turns out to matter more than what it does.
 *
 * The audit sells for $20 up front. Every established operator doing this exact
 * job charges nothing up front and takes a share of what is actually recovered:
 * TrueOps 10%, Helium 10's managed service 15-18%, Refully 18%, GETIDA and
 * Seller Investigators 25%, SellerVault tiered 10-25%. An entire industry has
 * converged on the opposite of what was built here, and it did not do so by
 * accident.
 *
 * The reason is the objection this system cannot otherwise answer. A stranger is
 * being asked to open their bank export for someone with no track record. At $20
 * up front the question is "why would I trust you"; on contingency there is
 * nothing to trust — if nothing is found, nothing is owed. It also aligns the
 * incentive visibly, which is the argument those firms lead with.
 *
 * It fixes the fee problem as a side effect. 20% of the $2,862 the live demo
 * found is $572, where PayPal India's 9.4% take costs $54 rather than mattering.
 * On a $20 ticket that same rail eats $1.88 of it.
 *
 * The catch is real and is not hidden here: contingency requires knowing what
 * was recovered. The established firms solve it by filing the claims themselves
 * from inside the seller's account. A solo operator starting out cannot, so the
 * recovery is confirmed by the customer and the fee is invoiced against that
 * confirmation — weaker, and honest about being weaker.
 */

export const PRICING_MODEL = Object.freeze({
  FLAT: 'flat',
  CONTINGENCY: 'contingency'
});

/** What comparable firms charge, so the rate is anchored rather than invented. */
export const MARKET_CONTINGENCY_RATES = Object.freeze([
  { firm: 'TrueOps', percent: 10 },
  { firm: 'Helium 10 Managed', percent: 16.5, note: '15-18% depending on plan' },
  { firm: 'Refully', percent: 18 },
  { firm: 'GETIDA', percent: 25 },
  { firm: 'Seller Investigators', percent: 25 },
  { firm: 'SellerVault', percent: 17.5, note: 'tiered 10-25% by plan size' }
]);

export const DEFAULT_CONTINGENCY_PERCENT = 20;

/**
 * The fee for a recovery, and what is left after the payment rail takes its cut.
 *
 * `confirmedRecoveredCents` is what the customer confirmed actually landed —
 * never the audit's own finding. A finding is a question to ask the platform;
 * only the customer can say what came back, and billing the finding rather than
 * the recovery is how a contingency arrangement turns into a dispute.
 */
export function contingencyFee({
  confirmedRecoveredCents,
  percent = DEFAULT_CONTINGENCY_PERCENT,
  railCost = null
} = {}) {
  const recovered = Number(confirmedRecoveredCents);
  if (!Number.isFinite(recovered) || recovered <= 0) {
    return { billableCents: 0, reason: 'nothing was confirmed recovered, so nothing is owed' };
  }
  if (!(percent > 0 && percent <= 30)) {
    throw new Error('contingency percent must be between 0 and 30 — comparable firms charge 10-25%');
  }
  const billableCents = Math.round(recovered * (percent / 100));
  const railFeeCents = railCost
    ? Math.round(billableCents * ((railCost.percent + railCost.fxPercent) / 100)) + railCost.fixedCents
    : null;

  return {
    confirmedRecoveredCents: recovered,
    percent,
    billableCents,
    railFeeCents,
    netCents: railFeeCents == null ? null : billableCents - railFeeCents,
    // The comparison that decides whether the model is worth switching to.
    railTakeOfFeePct: railFeeCents == null ? null
      : Number(((railFeeCents / billableCents) * 100).toFixed(1)),
    reason: null
  };
}

/**
 * Whether a finding is worth billing on contingency at all.
 *
 * Below a floor the fee does not cover the effort of invoicing and chasing it,
 * and offering to bill it makes the operator look like they are scraping. The
 * finding is still given away — it costs nothing and it is the whole reason
 * anyone would come back.
 */
export function worthBilling({ confirmedRecoveredCents, percent = DEFAULT_CONTINGENCY_PERCENT,
  minimumFeeCents = 1000 } = {}) {
  const fee = contingencyFee({ confirmedRecoveredCents, percent });
  return {
    bill: fee.billableCents >= minimumFeeCents,
    feeCents: fee.billableCents,
    reason: fee.billableCents >= minimumFeeCents
      ? null
      : `a ${percent}% fee on ${(Number(confirmedRecoveredCents) / 100).toFixed(2)} is `
        + `${(fee.billableCents / 100).toFixed(2)}, below the ${(minimumFeeCents / 100).toFixed(2)} `
        + 'floor where invoicing is worth the effort — give the finding away'
  };
}
