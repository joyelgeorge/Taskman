import { parsePayouts, parseDeposits } from './payout-csv.js';
import { matchPayouts } from './instant-audit.js';
import { analyseFeeRecovery } from './fee-recovery.js';

/**
 * The paid deliverable: everything the free check does, plus the findings that
 * need the whole period rather than a pasted sample.
 *
 * This exists because the offer promised a report nothing generated. Selling a
 * deliverable that does not exist is worse than having no offer, so the report is
 * built before the payment link, not after.
 *
 * Same discipline as the free audit throughout. Every number is computed from the
 * two files; nothing is projected, no recovery is estimated, and every finding is
 * phrased as something to check rather than something proven. A reconciliation
 * that overstates gets its user into an argument with their platform holding
 * evidence that does not survive contact.
 */

/** A fee this far from the median rate is worth a look. Flag, not verdict. */
const FEE_OUTLIER_TOLERANCE = 0.02;
/** Payouts slower than the median by this many days are surfaced. */
const LATENCY_OUTLIER_DAYS = 14;

const usd = cents => `$${(cents / 100).toFixed(2)}`;
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86_400_000);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * What the platform charged, and whether it charged consistently.
 *
 * The effective rate is the honest headline: sellers routinely misremember their
 * fee as the advertised rate when currency conversion and payment processing make
 * the real one higher. An outlier is reported as a deviation, never as an
 * overcharge — a different fee usually means a different product or promotion.
 */
export function analyseFees(payouts) {
  const withFees = payouts.filter(p => p.feeCents != null && p.grossCents);
  if (withFees.length === 0) {
    return {
      available: false,
      reason: 'No fee column in the earnings file, so nothing about fees can be said from it.'
    };
  }
  const totalFee = withFees.reduce((s, p) => s + p.feeCents, 0);
  const totalGross = withFees.reduce((s, p) => s + p.grossCents, 0);
  const rates = withFees.map(p => p.feeCents / p.grossCents);
  const medianRate = median(rates);

  const outliers = withFees
    .map(p => ({ ...p, rate: p.feeCents / p.grossCents }))
    .filter(p => Math.abs(p.rate - medianRate) > FEE_OUTLIER_TOLERANCE)
    .map(p => ({
      orderId: p.orderId, date: p.date, grossCents: p.grossCents, feeCents: p.feeCents,
      ratePct: Number((p.rate * 100).toFixed(2)),
      note: `Charged ${(p.rate * 100).toFixed(2)}% where the usual rate here is `
        + `${(medianRate * 100).toFixed(2)}%. Often a different product or promotion — worth checking why.`
    }));

  return {
    available: true,
    countWithFees: withFees.length,
    totalFeeCents: totalFee,
    totalGrossCents: totalGross,
    effectiveRatePct: Number(((totalFee / totalGross) * 100).toFixed(2)),
    medianRatePct: Number((medianRate * 100).toFixed(2)),
    outliers
  };
}

/**
 * The same order counted twice, and the same deposit landing twice.
 *
 * Duplicates cut both ways: a duplicated earning row inflates what you think you
 * are owed and produces a false shortfall, while a duplicated deposit is money
 * that may have to be given back. Both are reported.
 */
export function findDuplicates(payouts, deposits) {
  const byOrder = new Map();
  for (const p of payouts) {
    if (!p.orderId) continue;
    byOrder.set(p.orderId, [...(byOrder.get(p.orderId) || []), p]);
  }
  const duplicateEarnings = [...byOrder.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([orderId, rows]) => ({
      orderId, count: rows.length, rows: rows.map(r => r.rowNumber),
      note: 'This reference appears more than once in the earnings file. If it is one order, '
        + 'the total owed is overstated and any shortfall against it is not real.'
    }));

  const seen = new Map();
  const duplicateDeposits = [];
  for (const d of deposits) {
    const key = `${d.date}|${d.amountCents}`;
    if (seen.has(key)) {
      duplicateDeposits.push({
        date: d.date, amountCents: d.amountCents, rows: [seen.get(key), d.rowNumber],
        note: 'Two identical credits on the same day. Often genuinely two payouts; occasionally '
          + 'a double payment that gets clawed back later.'
      });
    } else {
      seen.set(key, d.rowNumber);
    }
  }
  return { duplicateEarnings, duplicateDeposits };
}

/** How long money took to arrive, and which payouts sat unusually long. */
export function analyseLatency(matched) {
  const withDates = matched.filter(m => m.earnedOn && m.depositedOn);
  if (withDates.length === 0) return { available: false };
  const lags = withDates.map(m => days(m.earnedOn, m.depositedOn)).filter(Number.isFinite);
  const med = median(lags);
  return {
    available: true,
    medianDays: med,
    slowest: withDates
      .map(m => ({ ...m, lagDays: days(m.earnedOn, m.depositedOn) }))
      .filter(m => m.lagDays - med > LATENCY_OUTLIER_DAYS)
      .sort((a, b) => b.lagDays - a.lagDays)
      .slice(0, 10)
  };
}

/**
 * The whole report. Structured data only — rendering is separate so the same
 * findings can be delivered as a page, an email or a row in the ledger.
 */
export function buildFullReport({
  platformCsv, bankCsv, preparedFor = null, homeCurrency = null, now = new Date()
} = {}) {
  const platform = parsePayouts(platformCsv);
  const bank = parseDeposits(bankCsv);
  const { matched, unmatchedEarnings, unmatchedDeposits } = matchPayouts({
    transactions: platform.payouts, deposits: bank.deposits
  });

  const missingCents = unmatchedEarnings.reduce((s, e) => s + e.netCents, 0);
  const fees = analyseFees(platform.payouts);
  // Named causes for the anomalies analyseFees only counts. "This fee is unusual"
  // is a curiosity; "this looks like an interchange downgrade, ask which category
  // it settled at" is something the customer can actually walk into a support
  // conversation holding.
  const feeRecovery = fees.available
    ? analyseFeeRecovery(platform.payouts, { homeCurrency })
    : { available: false, reason: fees.reason };
  const duplicates = findDuplicates(platform.payouts, bank.deposits);
  const latency = analyseLatency(matched);

  const period = {
    earliest: platform.payouts.map(p => p.date).filter(Boolean).sort()[0] || null,
    latest: platform.payouts.map(p => p.date).filter(Boolean).sort().slice(-1)[0] || null
  };

  // Ordered by how much money is at stake, so the first line read is the one
  // worth acting on.
  const actions = [];
  if (unmatchedEarnings.length) {
    actions.push(`Ask your platform about ${unmatchedEarnings.length} payout(s) totalling `
      + `${usd(missingCents)} that do not appear in the bank file.`);
  }
  if (duplicates.duplicateEarnings.length) {
    actions.push(`Check ${duplicates.duplicateEarnings.length} duplicated reference(s) in the `
      + 'earnings export before treating any shortfall as real.');
  }
  if (feeRecovery.available && (feeRecovery.findings.length || feeRecovery.minor.count)) {
    const causes = [...new Set(feeRecovery.findings.map(f => f.cause.replace(/_/g, ' ')))];
    if (causes.length === 0) causes.push('small consistent overcharges');
    const lines = feeRecovery.findings.length + feeRecovery.minor.count;
    actions.push(`Query ${usd(feeRecovery.amountInQuestionCents)} of fees charged above your own `
      + `median across ${lines} order(s) — most likely ${causes.join(' or ')}.`
      + (feeRecovery.minor.count
        ? ` ${usd(feeRecovery.minor.amountInQuestionCents)} of that is spread across `
          + `${feeRecovery.minor.count} small order(s) worth raising only together.`
        : ''));
  } else if (fees.available && fees.outliers.length) {
    actions.push(`Ask why ${fees.outliers.length} order(s) were charged a rate away from your usual `
      + `${fees.medianRatePct}%.`);
  }
  if (duplicates.duplicateDeposits.length) {
    actions.push(`Confirm ${duplicates.duplicateDeposits.length} identical same-day credit(s) are `
      + 'genuinely two payouts.');
  }
  if (actions.length === 0) actions.push('Nothing to chase. Everything in these files reconciles.');

  return {
    preparedFor,
    preparedAt: now.toISOString(),
    period,
    columnsUsed: { earnings: platform.columns, deposits: bank.columns },
    assumptions: platform.assumptions,
    summary: {
      ordersRead: platform.payouts.length,
      depositsRead: bank.deposits.length,
      matchedCount: matched.length,
      unmatchedEarningsCount: unmatchedEarnings.length,
      unmatchedEarningsCents: missingCents,
      depositsWithNoOrderCount: unmatchedDeposits.length
    },
    findings: {
      earningsWithNoDeposit: unmatchedEarnings,
      depositsWithNoOrder: unmatchedDeposits,
      ...duplicates,
      fees,
      feeRecovery,
      latency
    },
    actions,
    // Stated once, plainly, and never softened by a projection elsewhere.
    limits: 'This report compares two files and nothing else. It cannot see payouts outside the '
      + 'exported dates, and a gap is a question to ask, not proof of loss.'
  };
}

/**
 * The report as a self-contained page the buyer can save, print or forward.
 *
 * No external assets, so it survives being emailed as an attachment or opened
 * years later. Deliberately plain: this is a document someone may take to their
 * platform's support desk, and it should read like a record rather than a pitch.
 */
export function renderReportHtml(report) {
  const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
  const money = cents => usd(cents);
  const rows = (items, cells) => items.map(i => `<tr>${cells(i).map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
  const section = (title, body) => body ? `<h2>${esc(title)}</h2>${body}` : '';

  const f = report.findings;
  const missingTable = f.earningsWithNoDeposit.length ? `
    <table><thead><tr><th>Reference</th><th>Earned</th><th class="n">Net</th></tr></thead>
    <tbody>${rows(f.earningsWithNoDeposit, m =>
      [esc(m.orderId ?? '—'), esc(m.earnedOn ?? '—'), `<span class="n">${money(m.netCents)}</span>`])}</tbody></table>
    <p class="note">Each of these appears in the earnings export with no matching credit in the bank
    file. Check them against your statement for the surrounding weeks before raising them.</p>` : '';

  const feeBlock = f.fees.available ? `
    <p>Across ${f.fees.countWithFees} order(s) with a stated fee, you paid
    <strong>${money(f.fees.totalFeeCents)}</strong> on ${money(f.fees.totalGrossCents)} gross —
    an effective rate of <strong>${f.fees.effectiveRatePct}%</strong>, against a median of
    ${f.fees.medianRatePct}%.</p>
    ${f.fees.outliers.length ? `<table><thead><tr><th>Reference</th><th>Date</th><th class="n">Gross</th><th class="n">Fee</th><th class="n">Rate</th></tr></thead>
    <tbody>${rows(f.fees.outliers, o => [esc(o.orderId ?? '—'), esc(o.date ?? '—'),
      `<span class="n">${money(o.grossCents)}</span>`, `<span class="n">${money(o.feeCents)}</span>`,
      `<span class="n">${o.ratePct}%</span>`])}</tbody></table>
    <p class="note">A rate away from your median usually means a different product or a promotion.
    It is a question, not an overcharge.</p>` : '<p class="note">Fees are consistent across the period.</p>'}`
    : `<p class="note">${esc(f.fees.reason)}</p>`;

  const recovery = f.feeRecovery;
  const recoveryBlock = recovery.available && (recovery.findings.length || recovery.minor.count) ? `
    <p><strong>${money(recovery.amountInQuestionCents)}</strong> was charged above your own median
    rate across ${recovery.findings.length} order(s). ${esc(recovery.basis)}</p>
    <table><thead><tr><th>Reference</th><th>Likely cause</th><th class="n">Rate</th><th class="n">In question</th></tr></thead>
    <tbody>${rows(recovery.findings, r2 => [esc(r2.orderId ?? '—'),
      esc(r2.cause.replace(/_/g, ' ')), `<span class="n">${r2.ratePct}%</span>`,
      `<span class="n">${money(r2.amountInQuestionCents)}</span>`])}</tbody></table>
    ${recovery.findings.map(r2 => `<p class="note"><strong>${esc(r2.orderId ?? '—')}:</strong>
      ${esc(r2.ask)}${r2.typical ? ` ${esc(r2.typical)}` : ''}</p>`).join('')}
    ${recovery.minor.note ? `<p class="note">${esc(recovery.minor.note)}</p>` : ''}
    <p class="note">Flagged above ${recovery.threshold.flaggedAbovePct}% —
      ${esc(recovery.threshold.basis)}</p>` : '';

  const dupBlock = (f.duplicateEarnings.length || f.duplicateDeposits.length) ? `
    ${f.duplicateEarnings.length ? `<p><strong>${f.duplicateEarnings.length}</strong> duplicated
      reference(s) in the earnings file: ${f.duplicateEarnings.map(d => esc(d.orderId)).join(', ')}.
      If each is one order, the total owed is overstated.</p>` : ''}
    ${f.duplicateDeposits.length ? `<p><strong>${f.duplicateDeposits.length}</strong> identical
      same-day credit(s) in the bank file. Usually two genuine payouts; occasionally a double
      payment that is later reversed.</p>` : ''}` : '';

  const latencyBlock = f.latency.available ? `
    <p>Payouts took a median of <strong>${f.latency.medianDays} day(s)</strong> to arrive.</p>
    ${f.latency.slowest.length ? `<p>${f.latency.slowest.length} took materially longer:
      ${f.latency.slowest.map(s => `${esc(s.orderId ?? '—')} (${s.lagDays}d)`).join(', ')}.</p>` : ''}` : '';

  return `<!doctype html>
<meta charset="utf-8">
<title>Payout reconciliation${report.preparedFor ? ` — ${esc(report.preparedFor)}` : ''}</title>
<style>
  body { font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
    max-width: 46rem; margin: 2.5rem auto; padding: 0 1.25rem; color: #1c1a17; }
  h1 { font-size: 1.6rem; margin: 0 0 .3rem; }
  h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; padding-bottom: .3rem; border-bottom: 1px solid #e3ded7; }
  .meta { color: #6b6560; font-size: .9rem; margin: 0 0 1.5rem; }
  .headline { font-size: 1.15rem; font-weight: 650; margin: 1.2rem 0 .3rem; }
  .flag { color: #8a2f22; } .ok { color: #245c3d; }
  table { width: 100%; border-collapse: collapse; margin: .6rem 0; font-size: .93rem; }
  th, td { text-align: left; padding: .45rem .5rem; border-bottom: 1px solid #e9e4dd; }
  th { font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: #6b6560; }
  .n { text-align: right; font-variant-numeric: tabular-nums; display: block; }
  th.n { text-align: right; }
  .note { color: #6b6560; font-size: .89rem; }
  ol { padding-left: 1.2rem; } ol li { margin: .35rem 0; }
  footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid #e3ded7; color: #6b6560; font-size: .85rem; }
  @media print { body { margin: 0; } }
</style>
<h1>Payout reconciliation</h1>
<p class="meta">
  ${report.preparedFor ? `Prepared for ${esc(report.preparedFor)}. ` : ''}
  ${report.period.earliest ? `Covering ${esc(report.period.earliest)} to ${esc(report.period.latest)}. ` : ''}
  ${report.summary.ordersRead} order(s) against ${report.summary.depositsRead} deposit(s).
</p>

<p class="headline ${report.summary.unmatchedEarningsCount ? 'flag' : 'ok'}">
  ${report.summary.unmatchedEarningsCount
    ? `${report.summary.unmatchedEarningsCount} payout(s) totalling ${money(report.summary.unmatchedEarningsCents)} have no matching deposit.`
    : `All ${report.summary.matchedCount} payout(s) reconcile.`}
</p>

<h2>What to do</h2>
<ol>${report.actions.map(a => `<li>${esc(a)}</li>`).join('')}</ol>

${section('Payouts with no matching deposit', missingTable)}
${section('Fees', feeBlock)}
${section('Fees worth querying', recoveryBlock)}
${section('Duplicates', dupBlock)}
${section('Timing', latencyBlock)}

<h2>How this was read</h2>
<p class="note">Earnings columns: <code>${esc(Object.values(report.columnsUsed.earnings).join(', '))}</code>.
Deposit columns: <code>${esc(Object.values(report.columnsUsed.deposits).join(', '))}</code>.
If either is wrong, the findings are wrong.</p>
${report.assumptions.map(a => `<p class="note">${esc(a)}</p>`).join('')}

<footer>${esc(report.limits)} Prepared ${esc(report.preparedAt.slice(0, 10))}.</footer>`;
}
