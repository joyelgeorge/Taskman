/**
 * The install-agnostic core of the Tally duplicate-invoice wedge.
 *
 * Works on a plain tabular export — rows a Tally install produces as XML/Excel —
 * so it needs no knowledge of the operator's specific install and no parsing of
 * Tally's proprietary on-disk format. It is DETECT only: it reads the export and
 * produces a flagged report. It never modifies the ledger. A human reviews the
 * report and the retailer acts on it.
 *
 * Two detections, both money the retailer can actually recover:
 *   1. the same invoice number posted twice — a duplicate charge
 *   2. the same vendor and amount within a short window — a likely double-payment
 *      under two different numbers
 */

const day = (d) => Math.floor(new Date(d).getTime() / 86_400_000);

/**
 * @param {Array}  rows  [{ invoiceNo, date, amount, vendor }]
 * @param {Object} opts  { windowDays } for the vendor+amount heuristic (default 5)
 */
export function findDuplicateInvoices(rows = [], { windowDays = 5 } = {}) {
  const flags = [];

  // 1. Exact repeated invoice number. The FIRST occurrence is the real charge;
  //    every later one is the recoverable duplicate.
  const seenNumbers = new Map();
  for (const r of rows) {
    if (!r || !r.invoiceNo) continue;
    if (seenNumbers.has(r.invoiceNo)) {
      flags.push({
        reason: 'same-invoice-number',
        invoiceNo: r.invoiceNo,
        vendor: r.vendor ?? null,
        date: r.date ?? null,
        recoverableAmount: Number(r.amount) || 0,
        original: seenNumbers.get(r.invoiceNo)
      });
    } else {
      seenNumbers.set(r.invoiceNo, { date: r.date ?? null, amount: Number(r.amount) || 0 });
    }
  }

  // 2. Same vendor + amount within windowDays, under different invoice numbers.
  const flaggedPair = new Set();
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (!a || !b || a.invoiceNo === b.invoiceNo) continue;
      if (a.vendor !== b.vendor) continue;
      if ((Number(a.amount) || 0) !== (Number(b.amount) || 0)) continue;
      if (Math.abs(day(a.date) - day(b.date)) > windowDays) continue;
      const key = [a.invoiceNo, b.invoiceNo].sort().join('|');
      if (flaggedPair.has(key)) continue;
      flaggedPair.add(key);
      flags.push({
        reason: 'same-vendor-amount-window',
        vendor: a.vendor,
        amount: Number(a.amount) || 0,
        invoiceNos: [a.invoiceNo, b.invoiceNo],
        dates: [a.date, b.date],
        recoverableAmount: Number(a.amount) || 0
      });
    }
  }

  return flags;
}

/**
 * Billed sales with no matching stock movement — goods invoiced but never
 * recorded as leaving the yard (shrinkage, or a billing error in the retailer's
 * favour that they will want corrected before an audit finds it).
 */
export function findBilledVsStockMismatch(sales = [], stock = []) {
  const movedOut = new Map();
  for (const s of stock) movedOut.set(s.item, (movedOut.get(s.item) || 0) + (Number(s.qtyOut) || 0));

  const flags = [];
  const billed = new Map();
  for (const s of sales) billed.set(s.item, (billed.get(s.item) || 0) + (Number(s.qty) || 0));

  for (const [item, qty] of billed) {
    const out = movedOut.get(item) || 0;
    if (qty > out) flags.push({ item, billedQty: qty, stockOutQty: out, unaccounted: qty - out });
  }
  return flags;
}

/** A plain-text report for the retailer. Draft only; a human sends it. */
export function renderDuplicateReport(flags = []) {
  if (!flags.length) return 'No duplicate charges or mismatches found in this export.';
  const total = flags.reduce((n, f) => n + (f.recoverableAmount || 0), 0);
  const lines = [
    `Found ${flags.length} item(s) worth reviewing — up to ${total} potentially recoverable.`,
    ''
  ];
  for (const f of flags) {
    if (f.reason === 'same-invoice-number') {
      lines.push(`• Invoice ${f.invoiceNo} (${f.vendor ?? 'unknown vendor'}) appears twice — ${f.recoverableAmount} charged again on ${f.date}.`);
    } else {
      lines.push(`• ${f.vendor}: ${f.amount} billed twice within days under ${f.invoiceNos.join(' and ')} — likely a double-payment.`);
    }
  }
  lines.push('', 'This is a draft for review. Confirm against the originals before acting.');
  return lines.join('\n');
}
