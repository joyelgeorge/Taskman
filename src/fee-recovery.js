/**
 * Names the likely cause of a fee anomaly, and what to ask about it.
 *
 * This is the fee-recovery model — the one proven business here — reduced to the
 * part that works without production access. Audit firms in this space plug into
 * a merchant's live processor; nobody hands API credentials to an operator with
 * no track record, so everything below is derived from an exported statement the
 * customer already has.
 *
 * The rest of the models considered alongside it were rejected on one shared
 * defect: they bill for a counterfactual. "We prevented an error" cannot be
 * settled — there is no external reference confirming money that never got
 * stuck, and src/money-ledger.js refuses revenue no external system can confirm.
 * A fee that was charged and can be disputed leaves a record on both sides.
 *
 * Nothing here asserts a recovery. Each finding is a named cause, the range it
 * usually costs, and the question to put to the processor. The amount is "in
 * question", never "what you will get back" — the customer is the one who will
 * be in that conversation, and they should arrive with a question they can
 * defend rather than a number we invented.
 */

/** Rate this far above the median is worth explaining rather than absorbing. */
const MATERIAL_RATE_GAP = 0.01;
/** Below this, the difference is rounding and not worth anyone's time. */
const MIN_QUESTIONABLE_CENTS = 50;

export const FEE_CAUSES = Object.freeze({
  INTERCHANGE_DOWNGRADE: 'interchange_downgrade',
  CROSS_BORDER: 'cross_border',
  REFUND_FEE_RETAINED: 'refund_fee_retained',
  DISPUTE_FEE: 'dispute_fee',
  UNEXPLAINED: 'unexplained'
});

const has = (text, ...words) => {
  const haystack = String(text || '').toLowerCase();
  return words.some(w => haystack.includes(w));
};

/**
 * Classifies one over-median fee.
 *
 * Order matters: an explicitly labelled dispute or refund row explains itself, so
 * those are checked before falling back to the interchange reading, which is an
 * inference rather than a label.
 */
export function classifyFeeAnomaly({ payout, medianRate, homeCurrency = null }) {
  const rate = payout.grossCents ? payout.feeCents / payout.grossCents : null;
  if (rate == null) return null;
  const excessCents = Math.round((rate - medianRate) * payout.grossCents);
  if (rate - medianRate < MATERIAL_RATE_GAP || excessCents < MIN_QUESTIONABLE_CENTS) return null;

  const label = `${payout.description || ''} ${payout.orderId || ''}`;
  const base = {
    orderId: payout.orderId ?? null,
    date: payout.date ?? null,
    grossCents: payout.grossCents,
    feeCents: payout.feeCents,
    ratePct: Number((rate * 100).toFixed(2)),
    medianRatePct: Number((medianRate * 100).toFixed(2)),
    // The gap against this account's own median, which is the only baseline
    // that is actually evidence. Not a published rate card we do not have.
    amountInQuestionCents: excessCents
  };

  if (has(label, 'dispute', 'chargeback', 'retrieval')) {
    return {
      ...base,
      cause: FEE_CAUSES.DISPUTE_FEE,
      typical: 'Dispute fees are commonly $15–25 and many processors return them when the dispute '
        + 'is resolved in the merchant\'s favour.',
      ask: 'If this dispute was won, ask whether the fee was reversed. Several processors refund it '
        + 'on a win but do not do so automatically.'
    };
  }

  if (has(label, 'refund', 'reversal', 'credit note')) {
    return {
      ...base,
      cause: FEE_CAUSES.REFUND_FEE_RETAINED,
      typical: 'Processors differ: some return the original processing fee on a refund, many keep it.',
      ask: 'Ask whether the original fee was returned on this refund. If your contract says it is '
        + 'returned and the statement shows it retained, that is a billing error to raise.'
    };
  }

  if (homeCurrency && payout.currency && String(payout.currency).toUpperCase() !== String(homeCurrency).toUpperCase()) {
    return {
      ...base,
      cause: FEE_CAUSES.CROSS_BORDER,
      typical: 'Cross-border and conversion markups commonly add 1–2% on top of the base rate.',
      ask: `This settled in ${String(payout.currency).toUpperCase()} rather than ${String(homeCurrency).toUpperCase()}. `
        + 'Ask what the conversion markup was, and whether settling in the original currency is cheaper.'
    };
  }

  // Larger card transactions carry commercial-card and Level 2/3 data rules, so
  // an unexplained gap concentrated there has a specific, checkable cause.
  if (payout.grossCents >= 20_000) {
    return {
      ...base,
      cause: FEE_CAUSES.INTERCHANGE_DOWNGRADE,
      typical: 'A downgrade — a transaction failing to qualify for its intended interchange category — '
        + 'typically costs 50–120 basis points.',
      ask: 'Ask your processor which interchange category this settled at and why it did not qualify. '
        + 'On commercial or corporate cards the usual cause is missing Level 2 or Level 3 data '
        + '(tax amount, customer reference, line items).'
    };
  }

  return {
    ...base,
    cause: FEE_CAUSES.UNEXPLAINED,
    typical: null,
    ask: 'Ask why this settled above your usual rate. It is frequently a different product, a '
      + 'promotion, or a card type — worth having the answer rather than assuming.'
  };
}

/**
 * Every over-median fee, grouped by cause.
 *
 * `amountInQuestionCents` is the total gap against the account's own median. It
 * is deliberately not called recoverable: some of it will have a good answer, and
 * a report that adds it up as recovery would be selling a number the customer
 * cannot collect.
 */
export function analyseFeeRecovery(payouts, { medianRate, homeCurrency = null } = {}) {
  if (medianRate == null || !Number.isFinite(medianRate)) {
    return { available: false, reason: 'No fee data, so no baseline rate to compare against.' };
  }
  const findings = payouts
    .map(payout => classifyFeeAnomaly({ payout, medianRate, homeCurrency }))
    .filter(Boolean)
    .sort((a, b) => b.amountInQuestionCents - a.amountInQuestionCents);

  const byCause = {};
  for (const finding of findings) {
    byCause[finding.cause] = byCause[finding.cause] || { count: 0, amountInQuestionCents: 0 };
    byCause[finding.cause].count += 1;
    byCause[finding.cause].amountInQuestionCents += finding.amountInQuestionCents;
  }

  return {
    available: true,
    findings,
    byCause,
    amountInQuestionCents: findings.reduce((sum, f) => sum + f.amountInQuestionCents, 0),
    basis: 'Measured against this account\'s own median rate over the period, not a published rate '
      + 'card. It is the amount worth asking about — some of it will have a good answer.'
  };
}
