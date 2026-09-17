import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  reconcileGstRecords,
  renderGstAuditReport,
  normalizeInvoiceNumber
} from '../packages/core/tally/gst-reconcile.js';
import { parseCsv } from '../packages/core/tally/parser.js';

test('normalizeInvoiceNumber cleans leading zeros and non-alphanumerics', () => {
  assert.equal(normalizeInvoiceNumber('00145'), '145');
  assert.equal(normalizeInvoiceNumber('INV/2026/081'), 'INV2026081');
  assert.equal(normalizeInvoiceNumber('  BHS-0042  '), 'BHS0042');
  assert.equal(normalizeInvoiceNumber(''), '');
});

test('reconcileGstRecords correctly categorizes matched, unclaimed, at-risk, and mismatched rows', async () => {
  const gstr2bCsv = await readFile(resolve(process.cwd(), 'test/fixtures/gstr2b-sample.csv'), 'utf8');
  const purchaseCsv = await readFile(resolve(process.cwd(), 'test/fixtures/purchase-register-sample.csv'), 'utf8');

  const gstr2bRaw = parseCsv(gstr2bCsv);
  const purchaseRaw = parseCsv(purchaseCsv);

  const gstr2bRows = gstr2bRaw.map(r => ({
    gstin: r.gstin,
    vendor: r.vendorname,
    invoiceNo: r.invoicenumber,
    date: r.invoicedate,
    taxableValue: r.taxablevalue,
    taxAmount: r.taxamount
  }));

  const purchaseRows = purchaseRaw.map(r => ({
    gstin: r.gstin,
    vendor: r.vendorname,
    invoiceNo: r.invoicenumber,
    date: r.invoicedate,
    taxableValue: r.taxablevalue,
    taxAmount: r.taxamount
  }));

  const result = reconcileGstRecords(gstr2bRows, purchaseRows, { toleranceRupees: 2 });

  // 1. Matched: Steel Corp (INV-2026-081) and Bangalore Hardware (BHS/0042 vs BHS-0042 fuzzy)
  assert.equal(result.matched.length, 2);
  assert.ok(result.matched.some(m => m.invoiceNo === 'INV-2026-081'));
  assert.ok(result.matched.some(m => normalizeInvoiceNumber(m.invoiceNo) === 'BHS0042'));

  // 2. Value mismatch: PKG-1049 (tax ₹2160 in 2B vs ₹2000 in books, diff = 160)
  assert.equal(result.valueMismatches.length, 1);
  assert.equal(result.valueMismatches[0].invoiceNo, 'PKG-1049');
  assert.equal(result.valueMismatches[0].difference, 160);

  // 3. Unclaimed ITC: Chennai Fasteners (₹1440) and Omitted Vendor Services (₹4500)
  assert.equal(result.unclaimedItc.length, 2);
  assert.equal(result.summary.unclaimedItcAmount, 5940);

  // 4. Missing from 2B (At-risk): Ghost Supplier Ltd (₹3000)
  assert.equal(result.missingFrom2b.length, 1);
  assert.equal(result.missingFrom2b[0].invoiceNo, 'MISSING-VENDOR-01');
  assert.equal(result.summary.atRiskItcAmount, 3000);

  // 5. Net Opportunity: ₹5940 unclaimed - ₹3000 at risk = ₹2940
  assert.equal(result.summary.netOpportunity, 2940);
});

test('renderGstAuditReport outputs markdown with summary and itemized breakdowns', () => {
  const mockRecon = {
    matched: [{ invoiceNo: 'INV-1', taxAmount: 1000 }],
    unclaimedItc: [
      { invoiceNo: 'INV-2', vendor: 'Alpha Steel', gstin: '29ABCDE1234F1Z5', date: '2026-08-01', taxableValue: 10000, recoverableItc: 1800 }
    ],
    missingFrom2b: [
      { invoiceNo: 'INV-3', vendor: 'Beta Chem', date: '2026-08-05', taxAmount: 500 }
    ],
    valueMismatches: [
      { invoiceNo: 'INV-4', vendor: 'Gamma Tools', gstr2bTax: 800, purchaseTax: 700, difference: 100 }
    ],
    summary: {
      matchedItc: 1000,
      unclaimedItcAmount: 1800,
      atRiskItcAmount: 500,
      netOpportunity: 1300
    }
  };

  const report = renderGstAuditReport(mockRecon);

  assert.match(report, /GST Input Tax Credit \(ITC\) Reconciliation Report/);
  assert.match(report, /Unclaimed ITC \(Potential Cash Recovery\): ₹1,800/);
  assert.match(report, /At-Risk ITC \(Vendor Non-Filing \/ Demand Risk\): ₹500/);
  assert.match(report, /Alpha Steel/);
  assert.match(report, /Beta Chem/);
  assert.match(report, /Gamma Tools/);
});
