import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCsv, normalizeInvoices, normalizeStockAndSales } from '../packages/core/tally/parser.js';
import { tallyLeakageJob, tallyLeakageDescriptor } from '../packages/core/jobs/tally-leakage.js';
import { assertValidJob, isRunnableJob, JOB_STAGE } from '../packages/core/jobs/job-spec.js';
import { runJob, STAGE_OUTCOME } from '../packages/core/jobs/runner.js';

test('tallyLeakageJob produces a structurally valid runnable job', () => {
  const job = tallyLeakageJob({ load: () => [] });
  assert.equal(isRunnableJob(job), true);
  assert.doesNotThrow(() => assertValidJob(job));
  assert.equal(job.key, 'tally-smb-leakage-audit');
  assert.equal(job.economics.pricing, 'contingency');
  assert.equal(job.economics.rate, 0.20);
  assert.equal(job.economics.currency, 'INR');
});

test('parseCsv and normalizers extract clean invoice and stock records from CSV', async () => {
  const csv = await readFile(resolve('data/tally/sample-retailer-vouchers.csv'), 'utf8');
  const rawRows = parseCsv(csv);
  assert.equal(rawRows.length, 6);

  const invoices = normalizeInvoices(rawRows);
  assert.equal(invoices.length, 6);
  assert.equal(invoices[0].invoiceNo, 'INV-2001');
  assert.equal(invoices[0].vendor, 'Apex Steel Traders');
  assert.equal(invoices[0].amount, 45000);

  const { sales, stock } = normalizeStockAndSales(rawRows);
  assert.equal(sales.length, 6);
  assert.equal(stock.length, 5); // row 6 has Qty Out = 0
});

test('tallyLeakageJob DETECT flags exact duplicates and window matches from real CSV', async () => {
  const csv = await readFile(resolve('data/tally/sample-retailer-vouchers.csv'), 'utf8');
  const job = tallyLeakageJob({ load: () => csv, clientName: 'Kochi Building Supplies' });

  const detectFn = job.stages[JOB_STAGE.DETECT];
  const result = await detectFn();

  assert.equal(result.clientName, 'Kochi Building Supplies');
  assert.equal(result.rowCount, 6);

  // Exact duplicate: INV-2001 posted twice for 45,000
  const exactDup = result.duplicateFlags.find(f => f.reason === 'same-invoice-number');
  assert.ok(exactDup, 'INV-2001 duplicate must be flagged');
  assert.equal(exactDup.recoverableAmount, 45000);

  // Shrinkage: National Hardware Mart fasteners billed 100 but 0 stock out
  assert.ok(result.stockFlags.some(s => s.item === 'Fasteners Box' && s.unaccounted === 100));

  assert.ok(result.totalRecoverableInr >= 45000);
  assert.equal(result.contingencyFeeInr, Math.round(result.totalRecoverableInr * 0.20));
});

test('tallyLeakageJob INTERVENE requires operator approval, and generates draft when approved', async () => {
  const csv = await readFile(resolve('data/tally/sample-retailer-vouchers.csv'), 'utf8');
  const written = [];
  const job = tallyLeakageJob({
    load: () => csv,
    clientName: 'Kochi Building Supplies',
    write: async (path, content) => written.push({ path, content })
  });

  // Run without approval -> stops at intervene
  const unapproved = await runJob(job, {
    approval: null,
    log: async () => {},
    settle: async () => {}
  });

  const interveneRun = unapproved.runs.find(r => r.stage === JOB_STAGE.INTERVENE);
  assert.equal(interveneRun.outcome, STAGE_OUTCOME.REFUSED);
  assert.equal(written.length, 0);

  // Run WITH approval -> executes intervene and produces draft report
  const approved = await runJob(job, {
    approval: 'operator:joyel',
    log: async () => {},
    settle: async () => {}
  });

  const approvedIntervene = approved.runs.find(r => r.stage === JOB_STAGE.INTERVENE);
  assert.equal(approvedIntervene.outcome, STAGE_OUTCOME.OK);
  assert.equal(written.length, 1);
  assert.match(written[0].content, /Tally Ledger Audit Report — Kochi Building Supplies/);
  assert.match(written[0].content, /20% Contingency/);
});

test('tallyLeakageJob CHARGE records settlement only when VERIFY yields valid reference', async () => {
  const csv = await readFile(resolve('data/tally/sample-retailer-vouchers.csv'), 'utf8');
  const settlements = [];

  const job = tallyLeakageJob({
    load: () => csv,
    clientName: 'Kochi Building Supplies',
    verifyRecovery: async () => ({
      source: 'manual_receipt',
      externalRef: 'UPI-AXIS-987654321',
      amountInr: 9000 // 20% of 45,000 recovered
    })
  });

  const res = await runJob(job, {
    approval: 'operator:joyel',
    log: async () => {},
    settle: async (s) => { settlements.push(s); return { id: 'test-settlement-1' }; }
  });

  assert.equal(res.charged, true);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].source, 'manual_receipt');
  assert.equal(settlements[0].externalRef, 'UPI-AXIS-987654321');
  assert.equal(settlements[0].grossCents, 900000); // 9000 INR = 900000 paise
  assert.equal(settlements[0].currency, 'INR');
});
