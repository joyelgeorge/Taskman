import test from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateInvoices, findBilledVsStockMismatch } from '../packages/core/tally/duplicate-invoice.js';

/**
 * The install-agnostic core of the Tally wedge. Works on a plain tabular export
 * (rows of {invoiceNo, date, amount, vendor}) that any Tally install can produce
 * as XML/Excel — so it is ready the moment the operator drops in one real export,
 * without parsing Tally's proprietary on-disk format or knowing the install.
 *
 * DETECT only. It produces a flagged report; it never modifies the ledger.
 */

const rows = [
  { invoiceNo: 'INV-1001', date: '2026-09-01', amount: 5000, vendor: 'Acme Stone' },
  { invoiceNo: 'INV-1002', date: '2026-09-02', amount: 3200, vendor: 'Bright Sand' },
  { invoiceNo: 'INV-1001', date: '2026-09-05', amount: 5000, vendor: 'Acme Stone' }, // exact dup invoice#
  { invoiceNo: 'INV-1003', date: '2026-09-03', amount: 3200, vendor: 'Bright Sand' }, // same vendor+amount, diff #
  { invoiceNo: 'INV-1099', date: '2026-09-03', amount: 3200, vendor: 'Bright Sand' }, // near-dup within window
];

test('an exactly repeated invoice number is flagged as a duplicate', () => {
  const dups = findDuplicateInvoices(rows);
  const exact = dups.find(d => d.reason === 'same-invoice-number');
  assert.ok(exact, 'INV-1001 appears twice and must be flagged');
  assert.equal(exact.invoiceNo, 'INV-1001');
  assert.equal(exact.recoverableAmount, 5000);
});

test('same vendor + amount within a short window is flagged as a likely double-payment', () => {
  const dups = findDuplicateInvoices(rows, { windowDays: 3 });
  const near = dups.find(d => d.reason === 'same-vendor-amount-window');
  assert.ok(near, 'two Bright Sand invoices for 3200 within 3 days is suspicious');
});

test('a clean ledger produces no false positives', () => {
  const clean = [
    { invoiceNo: 'A1', date: '2026-01-01', amount: 100, vendor: 'X' },
    { invoiceNo: 'A2', date: '2026-02-01', amount: 200, vendor: 'Y' }
  ];
  assert.deepEqual(findDuplicateInvoices(clean), []);
});

test('the total recoverable amount is the sum of the duplicate charges, not the originals', () => {
  const dups = findDuplicateInvoices(rows);
  const total = dups.filter(d => d.reason === 'same-invoice-number')
    .reduce((n, d) => n + d.recoverableAmount, 0);
  assert.equal(total, 5000, 'one duplicate of 5000 = 5000 recoverable, not 10000');
});

test('billed sales with no matching stock movement are flagged', () => {
  const sales = [{ item: 'RCA', qty: 10, invoiceNo: 'S1' }, { item: 'Mulch', qty: 5, invoiceNo: 'S2' }];
  const stock = [{ item: 'RCA', qtyOut: 10 }]; // Mulch billed but never left the yard
  const m = findBilledVsStockMismatch(sales, stock);
  assert.equal(m.length, 1);
  assert.equal(m[0].item, 'Mulch');
});

test('the detector never mutates its inputs', () => {
  const snapshot = JSON.stringify(rows);
  findDuplicateInvoices(rows);
  assert.equal(JSON.stringify(rows), snapshot, 'DETECT only — inputs are read, never written');
});
