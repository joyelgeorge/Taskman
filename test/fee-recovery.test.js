import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFeeAnomaly, analyseFeeRecovery, FEE_CAUSES } from '../src/fee-recovery.js';

const at = (rate, grossCents, extra = {}) => ({
  orderId: 'x', date: '2026-08-01', grossCents,
  feeCents: Math.round(grossCents * rate), ...extra
});

test('a fee at the median is not an anomaly', () => {
  assert.equal(classifyFeeAnomaly({ payout: at(0.029, 50000), medianRate: 0.029 }), null);
});

test('a difference too small to be worth a conversation is ignored', () => {
  // Half a point on a small order is rounding. Sending someone to their processor
  // over eighty cents costs them more than it returns.
  assert.equal(classifyFeeAnomaly({ payout: at(0.034, 2000), medianRate: 0.029 }), null);
});

test('a large over-median fee reads as an interchange downgrade, with the category to ask about', () => {
  const finding = classifyFeeAnomaly({ payout: at(0.046, 300000), medianRate: 0.029 });
  assert.equal(finding.cause, FEE_CAUSES.INTERCHANGE_DOWNGRADE);
  assert.match(finding.ask, /Level 2 or Level 3/);
  assert.match(finding.typical, /50–120 basis points/);
});

test('a labelled dispute explains itself before any interchange inference is made', () => {
  const finding = classifyFeeAnomaly({
    payout: at(0.06, 300000, { description: 'chargeback fee' }), medianRate: 0.029
  });
  assert.equal(finding.cause, FEE_CAUSES.DISPUTE_FEE, 'a labelled row must beat an inference');
});

test('a foreign settlement currency is read as cross-border, not as a downgrade', () => {
  const finding = classifyFeeAnomaly({
    payout: at(0.05, 60000, { currency: 'EUR' }), medianRate: 0.029, homeCurrency: 'USD'
  });
  assert.equal(finding.cause, FEE_CAUSES.CROSS_BORDER);
  assert.match(finding.ask, /EUR rather than USD/);
});

test('the same currency as home is never called cross-border', () => {
  const finding = classifyFeeAnomaly({
    payout: at(0.05, 60000, { currency: 'usd' }), medianRate: 0.029, homeCurrency: 'USD'
  });
  assert.notEqual(finding.cause, FEE_CAUSES.CROSS_BORDER);
});

test('the amount is measured against the account\'s own median, not an invented rate card', () => {
  const finding = classifyFeeAnomaly({ payout: at(0.05, 100000), medianRate: 0.029 });
  assert.equal(finding.amountInQuestionCents, Math.round((0.05 - 0.029) * 100000));
  assert.match(analyseFeeRecovery([at(0.05, 100000)], { medianRate: 0.029 }).basis, /not a published rate card/);
});

test('nothing is ever described as recovered, recoverable, or owed', () => {
  const result = analyseFeeRecovery(
    [at(0.05, 300000), at(0.06, 80000, { description: 'refund' })],
    { medianRate: 0.029 }
  );
  const serialized = JSON.stringify(result).toLowerCase();
  for (const word of ['recoverable', 'you will recover', 'owed to you', 'guaranteed', 'refund due']) {
    assert.equal(serialized.includes(word), false, `must not claim "${word}"`);
  }
  assert.ok(result.amountInQuestionCents > 0);
});

test('findings come back worst-first, so the biggest question is asked first', () => {
  const { findings } = analyseFeeRecovery(
    [at(0.05, 50000), at(0.05, 400000), at(0.05, 150000)], { medianRate: 0.029 }
  );
  const amounts = findings.map(f => f.amountInQuestionCents);
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
});

test('with no fee baseline it says so rather than inventing one', () => {
  const result = analyseFeeRecovery([at(0.05, 50000)], { medianRate: null });
  assert.equal(result.available, false);
  assert.match(result.reason, /no baseline rate/i);
});
