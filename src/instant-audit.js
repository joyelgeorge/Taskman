import { parsePayouts, parseDeposits } from './payout-csv.js';

/**
 * A payout audit a stranger can run before trusting us with anything.
 *
 * This exists because of the one gap that kept this system at zero revenue. The
 * reconciliation works — it correctly finds money that was earned and never
 * arrived — but nobody outside could ever reach it. executeCustomerReconciliation
 * refuses unless a workflow is ACTIVE, which requires a connected integration,
 * which requires a completed agency profile. Three commitment gates stand between
 * a stranger with a problem and any output at all, so the only people who could
 * ever see a finding were people who had already signed up. Nobody signs up to
 * find out whether there is anything to find.
 *
 * Every product that has made money doing this works the other way round: the
 * finding is the marketing. You paste your data, you see what you are owed, and
 * only then do you decide. So this path holds no state, stores nothing, requires
 * no account, and names the specific orders that never landed — an aggregate
 * "variance of $200" persuades nobody, while "order FO124, $200.00, earned 5 Aug,
 * never deposited" is checkable against their own bank in under a minute.
 *
 * It reports only what the two files actually show. No projected annual savings,
 * no assumed leakage rate, no estimate of any kind.
 *
 * Platform-agnostic on purpose. It was written against Fiverr exports, and a
 * single-platform seller is the one person who rarely has this problem — those
 * payout pipelines are automated and reconcile by construction. Money actually
 * goes missing for the operator running a processor plus a marketplace plus
 * PayPal, where nobody is reconciling across the seams. Any export with a date
 * and an amount now works.
 */

/** Payouts clear well after the order does, so a match is a window, not a date. */
const MATCH_WINDOW_DAYS = 45;
/** Cent tolerance, for rounding between a platform's net and a bank's credit. */
const AMOUNT_TOLERANCE_CENTS = 2;

const dayDiff = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86_400_000;

/**
 * Matches earnings to deposits, greedily by closest date among amount matches.
 *
 * Deliberately conservative: an unmatched earning is reported as "no deposit
 * found in these files", never as "they stole from you". The files may simply be
 * incomplete, and a tool that cries theft on a short bank export is worth less
 * than nothing — the first false accusation ends the relationship.
 */
export function matchPayouts({ transactions = [], deposits = [] } = {}) {
  const available = deposits.map((deposit, index) => ({ ...deposit, index, taken: false }));
  const matched = [];
  const unmatchedEarnings = [];

  for (const txn of transactions) {
    const net = Number(txn.netCents ?? txn.net_cents);
    const when = txn.date || txn.observedAt;
    if (!Number.isFinite(net) || net <= 0) continue;

    const candidates = available.filter(d =>
      !d.taken
      && Math.abs(Number(d.amountCents ?? d.amount_cents) - net) <= AMOUNT_TOLERANCE_CENTS
      && (!when || !d.date || dayDiff(when, d.date) <= MATCH_WINDOW_DAYS));

    candidates.sort((a, b) => dayDiff(when, a.date) - dayDiff(when, b.date));
    const hit = candidates[0];

    if (hit) {
      hit.taken = true;
      matched.push({ orderId: txn.orderId ?? txn.order ?? null, netCents: net, earnedOn: when, depositedOn: hit.date });
    } else {
      unmatchedEarnings.push({
        orderId: txn.orderId ?? txn.order ?? null,
        netCents: net,
        earnedOn: when,
        note: 'No deposit matching this amount appears in the bank file within '
          + `${MATCH_WINDOW_DAYS} days. It may be missing, delayed, or outside the exported range.`
      });
    }
  }

  const unmatchedDeposits = available
    .filter(d => !d.taken)
    .map(d => ({ amountCents: Number(d.amountCents ?? d.amount_cents), date: d.date, description: d.description || null }));

  return { matched, unmatchedEarnings, unmatchedDeposits };
}

const usd = cents => `$${(cents / 100).toFixed(2)}`;

/**
 * The whole audit, from two raw CSV strings to a finding someone can act on.
 *
 * Returns a headline that is true in every branch, including the one where
 * nothing is wrong. "Everything reconciles" is a real, useful answer and is
 * reported as success rather than dressed up as a problem to manufacture a sale.
 */
export function instantAudit({ platformCsv, bankCsv } = {}) {
  if (!platformCsv || !bankCsv) {
    throw new Error('Both a platform earnings CSV and a bank deposits CSV are required');
  }

  let platform;
  let bank;
  try {
    platform = parsePayouts(platformCsv);
  } catch (error) {
    return { ok: false, stage: 'platform_csv', error: String(error.message || error) };
  }
  try {
    bank = parseDeposits(bankCsv);
  } catch (error) {
    return { ok: false, stage: 'bank_csv', error: String(error.message || error) };
  }

  const transactions = platform.payouts;
  const { matched, unmatchedEarnings, unmatchedDeposits } = matchPayouts({
    transactions, deposits: bank.deposits
  });

  const missingCents = unmatchedEarnings.reduce((sum, e) => sum + e.netCents, 0);
  const feesCents = transactions.reduce((sum, t) => sum + Number(t.feeCents ?? 0), 0);

  return {
    ok: true,
    // Nothing about this call is retained. Said in the payload because it is the
    // reason someone is willing to run it at all.
    retention: 'Nothing from these files is stored. This response is computed and discarded.',
    // Which columns were read, so a misread header is caught by the person who
    // knows the file rather than becoming a confident wrong answer.
    columnsUsed: { earnings: platform.columns, deposits: bank.columns },
    assumptions: platform.assumptions,
    summary: {
      ordersRead: transactions.length,
      depositsRead: (bank.deposits || []).length,
      matchedCount: matched.length,
      unmatchedEarningsCount: unmatchedEarnings.length,
      unmatchedEarningsCents: missingCents,
      platformFeesCents: feesCents
    },
    findings: {
      // The part that sells: named orders, not an aggregate variance.
      earningsWithNoDeposit: unmatchedEarnings,
      depositsWithNoOrder: unmatchedDeposits
    },
    headline: unmatchedEarnings.length === 0
      ? `Every one of the ${matched.length} payouts in these files reconciles. Nothing is missing.`
      : `${unmatchedEarnings.length} payout(s) totalling ${usd(missingCents)} appear in your earnings `
        + 'but not in your bank file.',
    // Stated, never estimated. This system does not project a saving it has not
    // observed — the same rule the settlement ledger enforces on its own revenue.
    caveat: unmatchedEarnings.length === 0
      ? null
      : 'This compares two files, nothing more. A gap here is a question to ask your platform, '
        + 'not proof of loss — the likeliest explanation is a payout outside the exported date range.'
  };
}
