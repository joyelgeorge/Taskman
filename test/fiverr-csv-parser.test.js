import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFiverrActivityCsv, parseBankDepositsCsv } from '../src/fiverr-csv-parser.js';

test('parseFiverrActivityCsv successfully normalizes official Fiverr activity format', () => {
  const csv = `Date,Order ID,Type,Gross Amount,Platform Fee,Currency
2026-09-01,FO1234567,Completed Order,150.00,30.00,USD
2026-09-02,FO1234568,Completed Order,200.00,40.00,USD`;

  const parsed = parseFiverrActivityCsv(csv);
  assert.equal(parsed.rowCount, 2);
  assert.equal(parsed.summary.totalGrossCents, 35000);
  assert.equal(parsed.summary.totalFeeCents, 7000);
  assert.equal(parsed.summary.totalNetCents, 28000);
  assert.equal(parsed.transactions[0].orderId, 'FO1234567');
  assert.equal(parsed.transactions[0].grossCents, 15000);
  assert.equal(parsed.transactions[0].feeCents, 3000);
  assert.ok(parsed.fileHashSha256);
});

test('parseFiverrActivityCsv fails closed when required columns are absent', () => {
  const invalidCsv = `User,Review,Score
alice,Great job,5`;

  assert.throws(() => {
    parseFiverrActivityCsv(invalidCsv);
  }, /CSV missing required Fiverr columns/);
});

test('parseBankDepositsCsv normalizes bank payout records', () => {
  const bankCsv = `Date,Description,Deposit Amount
2026-09-03,Fiverr Payout Settlement,280.00`;

  const parsed = parseBankDepositsCsv(bankCsv);
  assert.equal(parsed.rowCount, 1);
  assert.equal(parsed.totalDepositedCents, 28000);
  assert.equal(parsed.deposits[0].amount, 280.00);
  assert.ok(parsed.fileHashSha256);
});
