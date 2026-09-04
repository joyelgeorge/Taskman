export const COMMERCIAL_WEDGE_SPEC = Object.freeze({
  id: 'fiverr_bookkeeping_reconciliation_v1',
  name: 'Fiverr Freelance Payout & Transaction Reconciliation',
  customerType: 'Digital agency owners & high-volume Fiverr sellers (>$3,000/mo volume)',
  recurringTrigger: 'Payout withdrawal notification or month-end bank settlement discrepancy',
  intervention: 'Automated cross-matching of Fiverr transaction ledger against bank/Stripe deposits',
  measurableOutcome: 'Exact dollar fee & withholding reconciliation ($300-$800/yr tax savings / leakage recovery)',
  paymentMechanism: 'Stripe subscription / usage-metered per reconciliation batch',
  priceCents: 1900, // $19.00 / mo
  batchFeeCents: 200, // $2.00 / batch
  status: 'ACTIVE_FOCUS',
  killCriteria: 'Trailing 30-day ROI drops below 1.5x after 50 attempts with zero converted customers'
});

/**
 * Reconciles a batch of Fiverr transactions against bank deposit records.
 */
export function reconcileFiverrPayoutBatch({
  transactions = [],
  deposits = []
} = {}) {
  let grossEarningsCents = 0;
  let platformFeesCents = 0;
  let netWithdrawnCents = 0;
  let bankDepositedCents = 0;
  const matched = [];
  const discrepancies = [];

  // 1. Sum up transactions
  for (const t of transactions) {
    const gross = Math.round((t.grossAmount || 0) * 100);
    const fee = Math.round((t.platformFee || 0) * 100);
    const net = gross - fee;

    grossEarningsCents += gross;
    platformFeesCents += fee;
    netWithdrawnCents += net;
  }

  // 2. Sum up deposits
  for (const d of deposits) {
    const amount = Math.round((d.amount || 0) * 100);
    bankDepositedCents += amount;
  }

  // 3. Match net withdrawal against deposits
  const deltaCents = netWithdrawnCents - bankDepositedCents;
  const balanced = deltaCents === 0;

  if (!balanced) {
    discrepancies.push({
      type: 'VARIANCE_DETECTED',
      withdrawnCents: netWithdrawnCents,
      depositedCents: bankDepositedCents,
      leakageOrFeeVarianceCents: deltaCents,
      description: deltaCents > 0
        ? `Unaccounted withdrawal leakage of $${(deltaCents / 100).toFixed(2)} (possible currency conversion fee or payout hold)`
        : `Unaccounted deposit excess of $${(Math.abs(deltaCents) / 100).toFixed(2)}`
    });
  }

  return {
    reconciledAt: new Date().toISOString(),
    balanced,
    summary: {
      transactionCount: transactions.length,
      depositCount: deposits.length,
      grossEarningsCents,
      platformFeesCents,
      netWithdrawnCents,
      bankDepositedCents,
      deltaCents,
      taxDeductiblePlatformFees: `$${(platformFeesCents / 100).toFixed(2)}`
    },
    discrepancies,
    evidenceRef: `fiverr-recon-${Date.now()}`
  };
}
