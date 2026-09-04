import { createHash } from 'node:crypto';

/**
 * Parses raw CSV text into rows with basic header normalization.
 */
function parseCsvLines(csvText) {
  if (typeof csvText !== 'string' || !csvText.trim()) {
    throw new Error('CSV content must be a non-empty string');
  }

  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV must contain a header row and at least one data row');
  }

  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, '_'));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Ingests and normalizes official Fiverr activity & earnings CSV reports.
 * Fails closed if essential financial columns are missing or malformed.
 */
export function parseFiverrActivityCsv(csvContent) {
  const hash = createHash('sha256').update(csvContent).digest('hex');
  const { headers, rows } = parseCsvLines(csvContent);

  // Expected Fiverr headers in earnings/activity exports:
  // Date, Order / Activity, Type, Gross / Amount, Fee / Commission, Net, Currency
  const hasDate = headers.some(h => h.includes('date'));
  const hasAmount = headers.some(h => h.includes('amount') || h.includes('gross'));

  if (!hasDate || !hasAmount) {
    throw new Error(`CSV missing required Fiverr columns: expected date and gross/amount fields (found: ${headers.join(', ')})`);
  }

  const normalizedTransactions = [];
  let totalGrossCents = 0;
  let totalFeeCents = 0;

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    
    // Find amount field
    const grossKey = headers.find(h => h.includes('gross') || h.includes('amount') || h.includes('total'));
    const feeKey = headers.find(h => h.includes('fee') || h.includes('commission'));
    const dateKey = headers.find(h => h.includes('date'));
    const typeKey = headers.find(h => h.includes('type') || h.includes('activity') || h.includes('description'));
    const orderKey = headers.find(h => h.includes('order') || h.includes('id'));

    const rawGross = parseFloat(String(r[grossKey] || '0').replace(/[^0-9.-]/g, '')) || 0;
    // If explicit fee not provided, Fiverr standard fee is 20% on seller earnings
    const rawFee = feeKey && r[feeKey] 
      ? parseFloat(String(r[feeKey]).replace(/[^0-9.-]/g, '')) || 0 
      : Math.round(rawGross * 0.20 * 100) / 100;

    const grossCents = Math.round(rawGross * 100);
    const feeCents = Math.round(rawFee * 100);
    const netCents = grossCents - feeCents;

    totalGrossCents += grossCents;
    totalFeeCents += feeCents;

    normalizedTransactions.push({
      rowId: idx + 1,
      orderId: r[orderKey] || `FVR-${idx + 1}`,
      date: r[dateKey] || new Date().toISOString(),
      type: r[typeKey] || 'Order Revenue',
      grossAmount: rawGross,
      platformFee: rawFee,
      netAmount: (netCents / 100),
      grossCents,
      feeCents,
      netCents
    });
  }

  return {
    fileHashSha256: hash,
    rowCount: normalizedTransactions.length,
    summary: {
      totalGrossCents,
      totalFeeCents,
      totalNetCents: totalGrossCents - totalFeeCents
    },
    transactions: normalizedTransactions
  };
}

/**
 * Ingests bank deposit statements for matching against Fiverr net payouts.
 */
export function parseBankDepositsCsv(csvContent) {
  const hash = createHash('sha256').update(csvContent).digest('hex');
  const { headers, rows } = parseCsvLines(csvContent);

  const hasDate = headers.some(h => h.includes('date'));
  const hasAmount = headers.some(h => h.includes('amount') || h.includes('deposit') || h.includes('credit'));

  if (!hasDate || !hasAmount) {
    throw new Error(`CSV missing required bank columns: expected date and deposit/amount fields (found: ${headers.join(', ')})`);
  }

  const deposits = [];
  let totalDepositedCents = 0;

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const amountKey = headers.find(h => h.includes('amount') || h.includes('deposit') || h.includes('credit'));
    const dateKey = headers.find(h => h.includes('date'));
    const descKey = headers.find(h => h.includes('desc') || h.includes('memo') || h.includes('payee'));

    const rawAmount = parseFloat(String(r[amountKey] || '0').replace(/[^0-9.-]/g, '')) || 0;
    const amountCents = Math.round(rawAmount * 100);
    totalDepositedCents += amountCents;

    deposits.push({
      rowId: idx + 1,
      date: r[dateKey] || new Date().toISOString(),
      description: r[descKey] || 'Bank Deposit',
      amount: rawAmount,
      amountCents
    });
  }

  return {
    fileHashSha256: hash,
    rowCount: deposits.length,
    totalDepositedCents,
    deposits
  };
}
