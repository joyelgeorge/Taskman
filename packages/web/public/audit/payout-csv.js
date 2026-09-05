/**
 * A payout/deposit CSV reader that does not care which platform produced the file.
 *
 * The original parser was written for Fiverr and, when a file had no fee column,
 * assumed Fiverr's 20% commission. Point a Stripe, PayPal or Shopify export at
 * that and it invents a fee, computes a net that is 20% too low, and then reports
 * a "missing payout" for money that arrived in full. A tool whose failure mode is
 * telling someone they were underpaid when they were not is worse than no tool:
 * the first false accusation ends the relationship.
 *
 * So nothing is ever assumed here. A fee exists only if a fee column exists. If
 * only an amount is present, that amount is the payout, and the caller is told
 * that is the reading being used.
 *
 * This also widens who the audit is for, which matters more than the parsing.
 * Single-platform sellers rarely lose payouts — the payout pipeline is automated
 * and reconciles by construction. The person who actually loses money is the
 * operator running Stripe plus PayPal plus a marketplace, where money genuinely
 * falls between systems and nobody is reconciling them.
 */

const CANDIDATES = Object.freeze({
  // Order matters: the first hint that matches a header wins, so the more
  // specific term is listed before the generic one it is a substring of.
  net: ['net', 'payout', 'paid_out', 'net_amount', 'amount_paid', 'settlement'],
  fee: ['fee', 'commission', 'charge', 'processing'],
  gross: ['gross', 'amount', 'total', 'subtotal', 'value', 'credit', 'deposit'],
  date: ['date', 'created', 'timestamp', 'time', 'posted'],
  id: ['order', 'transaction_id', 'txn', 'reference', 'invoice', 'id'],
  description: ['description', 'memo', 'payee', 'details', 'narrative', 'type', 'activity']
});

export function normalizeHeader(header) {
  return String(header).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Splits one CSV line, honouring quoted fields and escaped quotes. */
export function splitCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i += 1; } else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      out.push(current.trim()); current = '';
    } else {
      current += char;
    }
  }
  out.push(current.trim());
  return out;
}

/**
 * Reads an amount in cents.
 *
 * Handles currency symbols, thousands separators and accounting negatives —
 * "(1,234.56)" and "-$1,234.56" are the same number, and a refund read as income
 * is how a reconciliation quietly stops balancing.
 */
export function toCents(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text) || text.includes('-');
  const digits = text.replace(/[^0-9.]/g, '');
  if (!digits || Number.isNaN(Number(digits))) return null;
  const cents = Math.round(Number(digits) * 100);
  return negative ? -cents : cents;
}

/** Picks the best header for each role, reporting what it chose. */
export function detectColumns(headers) {
  const chosen = {};
  const taken = new Set();
  for (const [role, hints] of Object.entries(CANDIDATES)) {
    for (const hint of hints) {
      const match = headers.find(h => h.includes(hint) && !taken.has(h));
      if (match) { chosen[role] = match; taken.add(match); break; }
    }
  }
  return chosen;
}

function parseRows(csvText, label) {
  if (typeof csvText !== 'string' || !csvText.trim()) {
    throw new Error(`${label} CSV is empty`);
  }
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error(`${label} CSV needs a header row and at least one data row`);
  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const rows = lines.slice(1).map(line => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
  return { headers, rows };
}

/**
 * Earnings side: what the platform says you were owed.
 *
 * `netCents` is what should have reached the bank, and it is read rather than
 * derived wherever the file states it. The `assumptions` array is returned so the
 * caller can show the user which columns were used — a misread column produces a
 * confident wrong answer, and the only defence is saying out loud what was read.
 */
export function parsePayouts(csvText) {
  const { headers, rows } = parseRows(csvText, 'Earnings');
  const cols = detectColumns(headers);
  if (!cols.date && !cols.id) {
    throw new Error(`No date or reference column found. Columns read: ${headers.join(', ')}`);
  }
  if (!cols.net && !cols.gross) {
    throw new Error(`No amount column found. Columns read: ${headers.join(', ')}`);
  }

  const assumptions = [];
  if (!cols.net && cols.gross && !cols.fee) {
    assumptions.push(`No net or fee column found, so "${cols.gross}" is being treated as the amount `
      + 'that should have reached your bank. If that column is gross and fees are deducted before '
      + 'payout, the comparison will look short by the fee.');
  }

  const payouts = [];
  for (const [index, row] of rows.entries()) {
    const net = cols.net ? toCents(row[cols.net]) : null;
    const gross = cols.gross ? toCents(row[cols.gross]) : null;
    const fee = cols.fee ? Math.abs(toCents(row[cols.fee]) ?? 0) : null;
    // Read, then derive, and never invent. A fee exists only if the file says so.
    const netCents = net ?? (gross == null ? null : gross - (fee ?? 0));
    if (netCents == null || netCents <= 0) continue;

    payouts.push({
      orderId: (cols.id && row[cols.id]) || null,
      date: (cols.date && row[cols.date]) || null,
      description: (cols.description && row[cols.description]) || null,
      grossCents: gross,
      feeCents: fee,
      netCents,
      rowNumber: index + 2
    });
  }
  return { payouts, columns: cols, headers, assumptions };
}

/** Bank side: money that actually arrived. Credits only; debits are not payouts. */
export function parseDeposits(csvText) {
  const { headers, rows } = parseRows(csvText, 'Deposits');
  const cols = detectColumns(headers);
  if (!cols.gross && !cols.net) {
    throw new Error(`No amount column found. Columns read: ${headers.join(', ')}`);
  }
  const amountCol = cols.net || cols.gross;

  const deposits = [];
  for (const [index, row] of rows.entries()) {
    const amountCents = toCents(row[amountCol]);
    if (amountCents == null || amountCents <= 0) continue; // a debit is not a payout
    deposits.push({
      amountCents,
      date: (cols.date && row[cols.date]) || null,
      description: (cols.description && row[cols.description]) || null,
      rowNumber: index + 2
    });
  }
  return { deposits, columns: cols, headers };
}
