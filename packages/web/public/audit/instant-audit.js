import { parsePayouts, parseDeposits } from './payout-csv.js';

const MATCH_WINDOW_DAYS = 45;
const AMOUNT_TOLERANCE_CENTS = 2;
const dayDiff = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86_400_000;

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
        note: `No deposit matching this amount appears in the bank file within ${MATCH_WINDOW_DAYS} days.`
      });
    }
  }

  const unmatchedDeposits = available.filter(d => !d.taken).map(d => ({
    amountCents: Number(d.amountCents ?? d.amount_cents), date: d.date, description: d.description || null
  }));
  return { matched, unmatchedEarnings, unmatchedDeposits };
}

const usd = cents => `$${(cents / 100).toFixed(2)}`;

export function instantAudit({ platformCsv, bankCsv } = {}) {
  if (!platformCsv || !bankCsv) throw new Error('Both a platform earnings CSV and a bank deposits CSV are required');
  let platform;
  let bank;
  try { platform = parsePayouts(platformCsv); }
  catch (error) { return { ok: false, stage: 'platform_csv', error: String(error.message || error) }; }
  try { bank = parseDeposits(bankCsv); }
  catch (error) { return { ok: false, stage: 'bank_csv', error: String(error.message || error) }; }

  const transactions = platform.payouts;
  const { matched, unmatchedEarnings, unmatchedDeposits } = matchPayouts({ transactions, deposits: bank.deposits });
  const missingCents = unmatchedEarnings.reduce((sum, e) => sum + e.netCents, 0);
  const feesCents = transactions.reduce((sum, t) => sum + Number(t.feeCents ?? 0), 0);

  return {
    ok: true,
    retention: 'Nothing from these files is stored.',
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
    findings: { earningsWithNoDeposit: unmatchedEarnings, depositsWithNoOrder: unmatchedDeposits },
    headline: unmatchedEarnings.length === 0
      ? `Every one of the ${matched.length} payouts in these files reconciles. Nothing is missing.`
      : `${unmatchedEarnings.length} payout(s) totalling ${usd(missingCents)} appear in your earnings but not in your bank file.`,
    caveat: unmatchedEarnings.length === 0 ? null : 'This compares two files. A gap is a question for your platform, not proof of loss.'
  };
}
