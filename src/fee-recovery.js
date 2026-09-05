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

/**
 * What counts as an anomaly is derived from the account, not chosen by us.
 *
 * A fixed "1% above median" was a number with no basis. It is wrong in both
 * directions: on an account whose fees are identical to four decimal places, a
 * 0.4% jump is a glaring exception that a 1% floor hides; on a volatile account
 * with mixed card types, 1% is ordinary and every row trips it.
 *
 * So the threshold is the median absolute deviation of the account's own rates —
 * the spread that account actually runs at. MAD is used rather than standard
 * deviation precisely because the outliers are what is being looked for, and they
 * would inflate an SD until they no longer stood out from it.
 */
const MAD_MULTIPLIER = 3;
/**
 * Floor for float noise only, not a materiality judgement. Deliberately tiny.
 *
 * There used to be a 50-cent minimum, on the reasoning that nobody chases eighty
 * cents. That reasoning is human. Eighty cents across four hundred transactions
 * is $320, and the party asking is a machine that can enumerate all four hundred
 * without getting bored. Small findings are no longer discarded — they are
 * grouped, so the aggregate is visible even when no single line justifies a
 * conversation.
 */
const NOISE_FLOOR_CENTS = 1;
/** Below this a finding is reported in the aggregate rather than line by line. */
const INDIVIDUALLY_NOTABLE_CENTS = 50;

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
export function classifyFeeAnomaly({ payout, medianRate, rateThreshold = null, homeCurrency = null }) {
  const rate = payout.grossCents ? payout.feeCents / payout.grossCents : null;
  if (rate == null) return null;
  const excessCents = Math.round((rate - medianRate) * payout.grossCents);
  const gate = rateThreshold ?? medianRate;
  if (rate <= gate || excessCents < NOISE_FLOOR_CENTS) return null;

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
    amountInQuestionCents: excessCents,
    // Whether it is worth its own line, or belongs in the aggregate. Never a
    // reason to discard it.
    individuallyNotable: excessCents >= INDIVIDUALLY_NOTABLE_CENTS
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
/** Median absolute deviation: the spread this account actually runs at. */
export function medianAbsoluteDeviation(values, med) {
  if (!values.length) return 0;
  const deviations = values.map(v => Math.abs(v - med)).sort((a, b) => a - b);
  const mid = Math.floor(deviations.length / 2);
  return deviations.length % 2 ? deviations[mid] : (deviations[mid - 1] + deviations[mid]) / 2;
}

/**
 * The baseline is computed here, from the same rows the deviation is measured
 * over, rather than accepted from a caller. It was previously handed a median
 * rounded to two decimal places and derived from a slightly different set, which
 * made the threshold subtly inconsistent with the data it was applied to.
 */
export function analyseFeeRecovery(payouts, { medianRate = null, homeCurrency = null } = {}) {
  const rates = payouts
    .filter(p => p.grossCents && p.feeCents != null)
    .map(p => p.feeCents / p.grossCents)
    .sort((a, b) => a - b);

  if (rates.length === 0) {
    return { available: false, reason: 'No fee data, so no baseline rate to compare against.' };
  }
  const mid = Math.floor(rates.length / 2);
  const computedMedian = rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
  // An explicit median is honoured so a caller can supply a contracted rate, but
  // the file's own median is the default because it is the only figure actually
  // evidenced by the statement.
  medianRate = Number.isFinite(medianRate) ? medianRate : computedMedian;

  const mad = medianAbsoluteDeviation(rates, medianRate);
  // A perfectly consistent account has MAD 0, and then any deviation at all is
  // the exception — which is correct, and the noise floor stops it being noise.
  const rateThreshold = medianRate + (MAD_MULTIPLIER * mad);

  const all = payouts
    .map(payout => classifyFeeAnomaly({ payout, medianRate, rateThreshold, homeCurrency }))
    .filter(Boolean)
    .sort((a, b) => b.amountInQuestionCents - a.amountInQuestionCents);

  const findings = all.filter(f => f.individuallyNotable);
  const minor = all.filter(f => !f.individuallyNotable);

  const byCause = {};
  for (const finding of all) {
    byCause[finding.cause] = byCause[finding.cause] || { count: 0, amountInQuestionCents: 0 };
    byCause[finding.cause].count += 1;
    byCause[finding.cause].amountInQuestionCents += finding.amountInQuestionCents;
  }

  const minorCents = minor.reduce((sum, f) => sum + f.amountInQuestionCents, 0);

  return {
    available: true,
    findings,
    // Kept, not dropped. No single one of these is worth a phone call; together
    // they are frequently worth more than the headline, and enumerating all of
    // them costs nothing.
    minor: {
      count: minor.length,
      amountInQuestionCents: minorCents,
      note: minor.length
        ? `${minor.length} further order(s) were charged slightly above your median, totalling `
          + `$${(minorCents / 100).toFixed(2)}. No single one is worth raising; the total may be.`
        : null
    },
    byCause,
    amountInQuestionCents: all.reduce((sum, f) => sum + f.amountInQuestionCents, 0),
    threshold: {
      medianRatePct: Number((medianRate * 100).toFixed(3)),
      madPct: Number((mad * 100).toFixed(3)),
      flaggedAbovePct: Number((rateThreshold * 100).toFixed(3)),
      basis: `Anything beyond ${MAD_MULTIPLIER} median absolute deviations from this account's own `
        + 'median rate. Derived from the file, not a figure chosen in advance.'
    },
    basis: 'Measured against this account\'s own median rate over the period, not a published rate '
      + 'card. It is the amount worth asking about — some of it will have a good answer.'
  };
}
