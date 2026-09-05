const CANDIDATES = Object.freeze({
  net: ['net', 'payout', 'paid_out', 'net_amount', 'amount_paid', 'settlement'],
  fee: ['fee', 'commission', 'charge', 'processing'],
  gross: ['gross', 'amount', 'total', 'subtotal', 'value', 'credit', 'deposit'],
  date: ['date', 'created', 'timestamp', 'time', 'posted'],
  id: ['order', 'transaction_id', 'txn', 'reference', 'invoice', 'id'],
  currency: ['currency', 'ccy'],
  description: ['description', 'memo', 'payee', 'details', 'narrative', 'type', 'activity']
});

export function normalizeHeader(header) {
  return String(header).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

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
    } else current += char;
  }
  out.push(current.trim());
  return out;
}

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
  if (typeof csvText !== 'string' || !csvText.trim()) throw new Error(`${label} CSV is empty`);
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error(`${label} CSV needs a header row and at least one data row`);
  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const rows = lines.slice(1).map(line => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
  return { headers, rows };
}

export function parsePayouts(csvText) {
  const { headers, rows } = parseRows(csvText, 'Earnings');
  const cols = detectColumns(headers);
  if (!cols.date && !cols.id) throw new Error(`No date or reference column found. Columns: ${headers.join(', ')}`);
  if (!cols.net && !cols.gross) throw new Error(`No amount column found. Columns: ${headers.join(', ')}`);
  const assumptions = [];
  if (!cols.net && cols.gross && !cols.fee) {
    assumptions.push(`No net or fee column found, so "${cols.gross}" is treated as the bank amount.`);
  }
  const payouts = [];
  for (const [index, row] of rows.entries()) {
    const net = cols.net ? toCents(row[cols.net]) : null;
    const gross = cols.gross ? toCents(row[cols.gross]) : null;
    const fee = cols.fee ? Math.abs(toCents(row[cols.fee]) ?? 0) : null;
    const netCents = net ?? (gross == null ? null : gross - (fee ?? 0));
    if (netCents == null || netCents <= 0) continue;
    payouts.push({
      orderId: (cols.id && row[cols.id]) || null,
      date: (cols.date && row[cols.date]) || null,
      description: (cols.description && row[cols.description]) || null,
      grossCents: gross, feeCents: fee, netCents,
      currency: (cols.currency && row[cols.currency]) || null,
      rowNumber: index + 2
    });
  }
  return { payouts, columns: cols, headers, assumptions };
}

export function parseDeposits(csvText) {
  const { headers, rows } = parseRows(csvText, 'Deposits');
  const cols = detectColumns(headers);
  if (!cols.gross && !cols.net) throw new Error(`No amount column found. Columns: ${headers.join(', ')}`);
  const amountCol = cols.net || cols.gross;
  const deposits = [];
  for (const [index, row] of rows.entries()) {
    const amountCents = toCents(row[amountCol]);
    if (amountCents == null || amountCents <= 0) continue;
    deposits.push({
      amountCents,
      date: (cols.date && row[cols.date]) || null,
      description: (cols.description && row[cols.description]) || null,
      rowNumber: index + 2
    });
  }
  return { deposits, columns: cols, headers };
}
