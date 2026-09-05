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

test('a small finding is kept and grouped, not discarded', () => {
  // This used to assert the opposite: anything under fifty cents was dropped, on
  // the reasoning that nobody chases eighty cents. That reasoning is human.
  // Eighty cents across four hundred orders is $320, and the party enumerating
  // them is a machine that does not get bored. Small findings now land in the
  // aggregate instead of the floor.
  const many = [
    ...Array.from({ length: 50 }, () => at(0.029, 50000)),
    ...Array.from({ length: 40 }, () => at(0.04, 2000))
  ];
  const result = analyseFeeRecovery(many, {});
  assert.equal(result.findings.length, 0, 'no single small order is worth its own line');
  assert.equal(result.minor.count, 40);
  assert.ok(result.minor.amountInQuestionCents > 0, 'but the total is still reported');
  assert.match(result.minor.note, /the total may be/);
});

test('the threshold is derived from the account rather than chosen in advance', () => {
  // A tight account: 3 MAD of a near-zero spread flags a small deviation, which a
  // fixed 1% floor would have hidden entirely.
  const tight = [...Array.from({ length: 30 }, () => at(0.029, 100000)), at(0.035, 400000)];
  const result = analyseFeeRecovery(tight, {});
  assert.equal(result.findings.length, 1);
  assert.match(result.threshold.basis, /median absolute deviations/);

  // A volatile account: the same 0.6% gap is ordinary here, and is not flagged.
  const volatile = [
    ...Array.from({ length: 15 }, () => at(0.02, 100000)),
    ...Array.from({ length: 15 }, () => at(0.05, 100000)),
    at(0.035, 400000)
  ];
  assert.equal(analyseFeeRecovery(volatile, {}).findings.some(f => f.ratePct === 3.5), false,
    'a deviation smaller than the account\'s own spread is not an anomaly');
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
  // A realistic set: two points have no spread to measure against, so the
  // baseline needs a body of ordinary transactions behind it.
  const result = analyseFeeRecovery([
    ...Array.from({ length: 20 }, () => at(0.029, 50000)),
    at(0.05, 300000),
    at(0.06, 80000, { description: 'refund' })
  ], {});
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

test('with no fee data at all it says so rather than inventing a baseline', () => {
  const result = analyseFeeRecovery([{ orderId: 'x', grossCents: 50000, feeCents: null }], {});
  assert.equal(result.available, false);
  assert.match(result.reason, /no baseline rate/i);
});
