/**
 * GST Input Tax Credit (ITC) Reconciliation Engine.
 *
 * Compares vendor-filed tax records (GSTR-2B) against internal purchase records
 * (Purchase Register / Tally vouchers) to uncover:
 *   1. Unclaimed ITC: Invoices in GSTR-2B but missed in internal books (direct cash recovery).
 *   2. Ineligible / Missing ITC: Invoices claimed internally where vendor failed to file (tax demand & interest risk).
 *   3. Value Mismatches: Invoices where reported tax differs between vendor and books.
 */

/** Normalize invoice strings to catch punctuation and leading-zero discrepancies. */
export function normalizeInvoiceNumber(inv = '') {
  if (!inv) return '';
  return String(inv)
    .trim()
    .toUpperCase()
    .replace(/^0+/, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function parseAmount(val) {
  if (val == null) return 0;
  const num = Number(String(val).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? num : 0;
}

/**
 * Reconcile GSTR-2B vs Purchase Register.
 *
 * @param {Array} gstr2bRows   [{ gstin, vendor, invoiceNo, date, taxableValue, taxAmount }]
 * @param {Array} purchaseRows [{ gstin, vendor, invoiceNo, date, taxableValue, taxAmount }]
 * @param {Object} opts        { toleranceRupees }
 */
export function reconcileGstRecords(gstr2bRows = [], purchaseRows = [], { toleranceRupees = 2 } = {}) {
  const matched = [];
  const valueMismatches = [];
  const unclaimedItc = [];
  const missingFrom2b = [];

  const purchaseMap = new Map();
  const purchaseFuzzyMap = new Map();

  for (const pr of purchaseRows) {
    if (!pr || !pr.invoiceNo) continue;
    const norm = normalizeInvoiceNumber(pr.invoiceNo);
    const tax = parseAmount(pr.taxAmount);
    const taxable = parseAmount(pr.taxableValue);

    const record = {
      ...pr,
      taxAmount: tax,
      taxableValue: taxable,
      normalizedInv: norm,
      matched: false
    };

    if (!purchaseMap.has(norm)) {
      purchaseMap.set(norm, []);
    }
    purchaseMap.get(norm).push(record);

    const gstinKey = (pr.gstin || '').trim().toUpperCase();
    if (gstinKey) {
      const compositeKey = `${gstinKey}|${norm}`;
      if (!purchaseFuzzyMap.has(compositeKey)) {
        purchaseFuzzyMap.set(compositeKey, []);
      }
      purchaseFuzzyMap.get(compositeKey).push(record);
    }
  }

  // Iterate over GSTR-2B records
  for (const g2b of gstr2bRows) {
    if (!g2b || !g2b.invoiceNo) continue;
    const gNorm = normalizeInvoiceNumber(g2b.invoiceNo);
    const gTax = parseAmount(g2b.taxAmount);
    const gTaxable = parseAmount(g2b.taxableValue);
    const gGstin = (g2b.gstin || '').trim().toUpperCase();

    // Look for exact normalized invoice match with matching GSTIN or single match
    let candidates = null;
    if (gGstin && purchaseFuzzyMap.has(`${gGstin}|${gNorm}`)) {
      candidates = purchaseFuzzyMap.get(`${gGstin}|${gNorm}`);
    } else if (purchaseMap.has(gNorm)) {
      candidates = purchaseMap.get(gNorm);
    }

    const available = candidates ? candidates.find(c => !c.matched) : null;

    if (!available) {
      // In 2B but missing in Purchase Register -> Unclaimed ITC!
      unclaimedItc.push({
        invoiceNo: g2b.invoiceNo,
        vendor: g2b.vendor || 'Unknown Vendor',
        gstin: g2b.gstin ?? null,
        date: g2b.date ?? null,
        taxableValue: gTaxable,
        taxAmount: gTax,
        recoverableItc: gTax
      });
    } else {
      available.matched = true;
      const taxDiff = Math.abs(gTax - available.taxAmount);

      if (taxDiff <= toleranceRupees) {
        matched.push({
          invoiceNo: g2b.invoiceNo,
          vendor: g2b.vendor || available.vendor,
          gstin: g2b.gstin || available.gstin,
          date: g2b.date || available.date,
          taxAmount: gTax,
          taxableValue: gTaxable
        });
      } else {
        valueMismatches.push({
          invoiceNo: g2b.invoiceNo,
          vendor: g2b.vendor || available.vendor,
          gstin: g2b.gstin || available.gstin,
          gstr2bTax: gTax,
          purchaseTax: available.taxAmount,
          difference: Number((gTax - available.taxAmount).toFixed(2)),
          taxableGstr2b: gTaxable,
          taxablePurchase: available.taxableValue
        });
      }
    }
  }

  // Any purchase records not matched -> Ineligible / Missing from 2B!
  for (const pr of purchaseRows) {
    const norm = normalizeInvoiceNumber(pr?.invoiceNo);
    const list = purchaseMap.get(norm) || [];
    for (const item of list) {
      if (!item.matched) {
        item.matched = true; // Mark to prevent double-counting
        missingFrom2b.push({
          invoiceNo: item.invoiceNo,
          vendor: item.vendor || 'Unknown Vendor',
          gstin: item.gstin ?? null,
          date: item.date ?? null,
          taxableValue: item.taxableValue,
          taxAmount: item.taxAmount,
          atRiskAmount: item.taxAmount
        });
      }
    }
  }

  const totalGstr2bItc = gstr2bRows.reduce((sum, r) => sum + parseAmount(r?.taxAmount), 0);
  const totalPurchaseItc = purchaseRows.reduce((sum, r) => sum + parseAmount(r?.taxAmount), 0);
  const matchedItc = matched.reduce((sum, r) => sum + r.taxAmount, 0);
  const unclaimedItcAmount = unclaimedItc.reduce((sum, r) => sum + r.recoverableItc, 0);
  const atRiskItcAmount = missingFrom2b.reduce((sum, r) => sum + r.atRiskAmount, 0);

  return {
    matched,
    unclaimedItc,
    missingFrom2b,
    valueMismatches,
    summary: {
      totalGstr2bItc: Number(totalGstr2bItc.toFixed(2)),
      totalPurchaseItc: Number(totalPurchaseItc.toFixed(2)),
      matchedItc: Number(matchedItc.toFixed(2)),
      unclaimedItcAmount: Number(unclaimedItcAmount.toFixed(2)),
      atRiskItcAmount: Number(atRiskItcAmount.toFixed(2)),
      netOpportunity: Number((unclaimedItcAmount - atRiskItcAmount).toFixed(2))
    }
  };
}

/**
 * Render a forensic audit report suitable for review by the SME and their CA.
 */
export function renderGstAuditReport(reconciliation) {
  const { summary, unclaimedItc, missingFrom2b, valueMismatches } = reconciliation;

  const lines = [
    '# GST Input Tax Credit (ITC) Reconciliation Report',
    '',
    '## Executive Summary',
    `- Matched Verified ITC: ₹${summary.matchedItc.toLocaleString('en-IN')}`,
    `- Unclaimed ITC (Potential Cash Recovery): ₹${summary.unclaimedItcAmount.toLocaleString('en-IN')} (${unclaimedItc.length} invoices)`,
    `- At-Risk ITC (Vendor Non-Filing / Demand Risk): ₹${summary.atRiskItcAmount.toLocaleString('en-IN')} (${missingFrom2b.length} invoices)`,
    `- Rate/Value Discrepancies: ${valueMismatches.length} invoices`,
    ''
  ];

  if (unclaimedItc.length > 0) {
    lines.push('## 1. Unclaimed ITC (Available for Recovery on GSTR-3B)');
    lines.push('These invoices were reported by suppliers and tax was deposited, but are missing in your purchase register:');
    lines.push('');
    for (const item of unclaimedItc.slice(0, 50)) {
      lines.push(`• Inv #${item.invoiceNo} | ${item.vendor} (${item.gstin || 'no GSTIN'}) | Date: ${item.date || 'N/A'} | Taxable: ₹${item.taxableValue} | Unclaimed Tax: ₹${item.recoverableItc}`);
    }
    if (unclaimedItc.length > 50) {
      lines.push(`  ... and ${unclaimedItc.length - 50} additional invoices.`);
    }
    lines.push('');
  }

  if (missingFrom2b.length > 0) {
    lines.push('## 2. At-Risk ITC (Vendor Non-Filing Warning)');
    lines.push('You recorded these invoices in your books, but suppliers have NOT filed GSTR-1. Claiming these risks 18% p.a. interest penalties:');
    lines.push('');
    for (const item of missingFrom2b.slice(0, 50)) {
      lines.push(`• Inv #${item.invoiceNo} | ${item.vendor} | Date: ${item.date || 'N/A'} | Claimed Tax: ₹${item.taxAmount}`);
    }
    if (missingFrom2b.length > 50) {
      lines.push(`  ... and ${missingFrom2b.length - 50} additional invoices.`);
    }
    lines.push('');
  }

  if (valueMismatches.length > 0) {
    lines.push('## 3. Tax Amount Mismatches');
    lines.push('');
    for (const m of valueMismatches.slice(0, 50)) {
      lines.push(`• Inv #${m.invoiceNo} | ${m.vendor}: 2B Tax ₹${m.gstr2bTax} vs Book Tax ₹${m.purchaseTax} (Diff: ₹${m.difference})`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*Notice: This report is an analytical reconciliation draft intended for accountant verification. Verify with GSTR-2B portal downloads before filing.*');

  return lines.join('\n');
}
