#!/usr/bin/env node
/**
 * Standalone CLI runner for Tally SME leakage audits.
 *
 *   npm run tally -- <path-to-export.csv> [--window=5] [--client="Retailer Name"] [--save]
 *   npm run tally -- <path-to-export.csv> --approve=operator:joyel [--save]
 *   npm run tally -- <path-to-export.csv> --verify=UPI-12345678 --amount=15000
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tallyLeakageJob } from '../packages/core/jobs/tally-leakage.js';
import { runJob } from '../packages/core/jobs/runner.js';
import { databaseEnabled } from '../src/db.js';

import { reconcileGstRecords, renderGstAuditReport } from '../packages/core/tally/gst-reconcile.js';
import { parseCsv } from '../packages/core/tally/parser.js';

const argv = process.argv.slice(2);
const flag = (n) => {
  const withEq = argv.find(a => a.startsWith(`--${n}=`));
  if (withEq) return withEq.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : argv[i + 1];
};
const hasFlag = (n) => argv.some(a => a === `--${n}` || a.startsWith(`--${n}=`));

// Handle GST Reconciliation Mode
if (hasFlag('gst')) {
  const gstr2bPath = flag('gstr2b') || flag('2b');
  const purchasePath = flag('purchases') || flag('pr');
  const tolerance = parseFloat(flag('tolerance') || '2');
  const saveReport = hasFlag('save');

  if (!gstr2bPath || !purchasePath) {
    console.log(`usage:
  npm run tally -- --gst --gstr2b=<path-to-gstr2b.csv> --purchases=<path-to-purchases.csv> [options]

options:
  --tolerance=<rupees>    Tax rounding difference tolerance (default 2)
  --save                  Save markdown audit report to docs/outreach/
`);
    process.exit(0);
  }

  let gstr2bRaw, purchaseRaw;
  try {
    const [c1, c2] = await Promise.all([
      readFile(resolve(gstr2bPath), 'utf8'),
      readFile(resolve(purchasePath), 'utf8')
    ]);
    gstr2bRaw = parseCsv(c1);
    purchaseRaw = parseCsv(c2);
  } catch (err) {
    console.error(`error reading CSVs: ${err.message}`);
    process.exit(1);
  }

  const gstr2bRows = gstr2bRaw.map(r => ({
    gstin: r.gstin,
    vendor: r.vendorname || r.suppliername,
    invoiceNo: r.invoicenumber || r.invoiceno,
    date: r.invoicedate || r.date,
    taxableValue: r.taxablevalue,
    taxAmount: r.taxamount || r.integratedtax || r.centraltax
  }));

  const purchaseRows = purchaseRaw.map(r => ({
    gstin: r.gstin,
    vendor: r.vendorname || r.suppliername,
    invoiceNo: r.invoicenumber || r.invoiceno,
    date: r.invoicedate || r.date,
    taxableValue: r.taxablevalue,
    taxAmount: r.taxamount || r.tax
  }));

  const recon = reconcileGstRecords(gstr2bRows, purchaseRows, { toleranceRupees: tolerance });
  const report = renderGstAuditReport(recon);

  console.log('\n======================================================');
  console.log('       GST INPUT TAX CREDIT (ITC) AUDIT RESULTS       ');
  console.log('======================================================\n');
  console.log(`Matched Verified ITC:    ₹${recon.summary.matchedItc.toLocaleString('en-IN')}`);
  console.log(`Unclaimed ITC (Recovery):₹${recon.summary.unclaimedItcAmount.toLocaleString('en-IN')} (${recon.unclaimedItc.length} invoices)`);
  console.log(`At-Risk ITC (Vendor Risk):₹${recon.summary.atRiskItcAmount.toLocaleString('en-IN')} (${recon.missingFrom2b.length} invoices)`);
  console.log(`Value Discrepancies:     ${recon.valueMismatches.length} invoices`);
  console.log(`Net Potential Recovery:  ₹${recon.summary.netOpportunity.toLocaleString('en-IN')}\n`);

  if (saveReport) {
    const timestamp = new Date().toISOString().slice(0, 10);
    const outPath = resolve(`docs/outreach/gst-audit-${timestamp}.md`);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, report, 'utf8');
    console.log(`Detailed audit report written to: ${outPath}\n`);
  }

  process.exit(0);
}

const filePath = argv.find(a => !a.startsWith('--'));
if (!filePath) {
  console.log(`usage:
  npm run tally -- <path-to-export.csv> [options]
  npm run tally -- --gst --gstr2b=<path-to-gstr2b.csv> --purchases=<path-to-purchases.csv>

options:
  --window=<days>          Window in days for matching vendor + amount (default 5)
  --client=<name>          Client/store name (default "Retailer")
  --approve=<operator:id>  Operator approval token for draft generation
  --verify=<ref>           Payment/recovery reference from client to trigger settlement
  --amount=<inr>           Confirmed recovered amount in INR
  --save                   Save markdown audit report to docs/outreach/
`);
  process.exit(0);
}

const windowDays = parseInt(flag('window') || '5', 10);
const clientName = flag('client') || 'Retailer';
const approval = flag('approve');
const verifyRef = flag('verify');
const confirmedAmount = parseFloat(flag('amount') || '0');
const shouldSave = hasFlag('save') || Boolean(approval);

let content = '';
try {
  content = await readFile(resolve(filePath), 'utf8');
} catch (e) {
  console.error(`error: could not read file "${filePath}": ${e.message}`);
  process.exit(1);
}

const job = tallyLeakageJob({
  load: async () => content,
  windowDays,
  clientName,
  write: shouldSave ? async (p, text) => {
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, text);
    console.log(`\nAudit report written to: ${p}`);
  } : null,
  verifyRecovery: verifyRef ? async () => ({
    source: 'manual_receipt',
    externalRef: verifyRef,
    amountInr: confirmedAmount > 0 ? confirmedAmount : 0
  }) : null
});

console.log(`\nRunning Tally SME Leakage Audit for "${clientName}"...`);
console.log(`Input: ${filePath} (${content.split('\n').length} lines)\n`);

const result = await runJob(job, { approval });

for (const r of result.runs) {
  console.log(`${r.stage.padEnd(12)} ${r.outcome.padEnd(9)} ${r.reason || ''}`);
  if (r.stage === 'detect' && r.result) {
    console.log(`  Records scanned:      ${r.result.rowCount}`);
    console.log(`  Duplicate items:      ${r.result.duplicateFlags.length}`);
    console.log(`  Stock discrepancies:  ${r.result.stockFlags.length}`);
    console.log(`  Total Recoverable:    ₹${r.result.totalRecoverableInr.toLocaleString('en-IN')}`);
    console.log(`  Contingency Fee (20%):₹${r.result.contingencyFeeInr.toLocaleString('en-IN')}`);
  }
}

if (!approval && !result.charged) {
  console.log('\n[Note] Re-run with --approve=operator:<name> to generate and save formal client audit report.');
}

if (result.charged) {
  console.log(`\n✓ Settlement successfully recorded for ${clientName}!`);
}

process.exit(result.charged || !result.stopped ? 0 : 0);
