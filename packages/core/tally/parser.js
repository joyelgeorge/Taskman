/**
 * Ingest and normalize tabular exports from Tally ERP / TallyPrime.
 *
 * Tally can export vouchers and registers as CSV or XML. This module normalizes
 * common variations in header naming (e.g. "Vch No" vs "Invoice No", "Date",
 * "Particulars" vs "Party Name", "Amount" vs "Debit") into the canonical
 * shapes expected by the duplicate invoice and shrinkage detector.
 */

/**
 * Split CSV line handling quotes and commas.
 */
function parseCsvLine(line) {
  const cells = [];
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
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Parse CSV text into an array of objects keyed by header names.
 */
export function parseCsv(csvText = '') {
  const lines = csvText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] ?? '';
    });
    rows.push(obj);
  }

  return rows;
}

/**
 * Normalize an array of raw parsed objects into invoice rows for duplicate detection:
 * [{ invoiceNo, date, amount, vendor }]
 */
export function normalizeInvoices(records = []) {
  return records.map(r => {
    // Determine invoice number
    const invoiceNo = r.invoiceno || r.vchno || r.voucherno || r.billno || r.refno || r.id || '';
    
    // Determine date
    const date = r.date || r.voucherdate || r.invoicedate || '';

    // Determine amount (handling currency symbols and commas)
    const rawAmt = r.amount || r.debit || r.total || r.grandtotal || r.netamount || '0';
    const cleanAmt = String(rawAmt).replace(/[^0-9.-]/g, '');
    const amount = parseFloat(cleanAmt) || 0;

    // Determine vendor / party
    const vendor = r.vendor || r.particulars || r.partyname || r.supplier || r.account || null;

    return {
      invoiceNo: String(invoiceNo).trim(),
      date: String(date).trim(),
      amount,
      vendor: vendor ? String(vendor).trim() : null
    };
  }).filter(r => r.invoiceNo || r.amount > 0);
}

/**
 * Normalize sales and stock movement records for shrinkage detection.
 */
export function normalizeStockAndSales(records = []) {
  const sales = [];
  const stock = [];

  for (const r of records) {
    const item = r.item || r.itemname || r.stockitem || r.description || '';
    if (!item) continue;

    const qty = parseFloat(String(r.qty || r.quantity || r.billedqty || '0').replace(/[^0-9.-]/g, '')) || 0;
    const qtyOut = parseFloat(String(r.qtyout || r.dispatchedqty || r.stockout || '0').replace(/[^0-9.-]/g, '')) || 0;

    if (qty > 0) sales.push({ item: String(item).trim(), qty });
    if (qtyOut > 0) stock.push({ item: String(item).trim(), qtyOut });
  }

  return { sales, stock };
}
