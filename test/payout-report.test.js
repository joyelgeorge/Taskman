import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFullReport, renderReportHtml, analyseFees, findDuplicates } from '../src/payout-report.js';

const platform = `id,Created,Amount,Fee,Net
ch_1,2026-08-01,100.00,3.20,96.80
ch_2,2026-08-05,250.00,7.55,242.45
ch_3,2026-08-09,80.00,24.00,56.00`;
const bank = `Date,Description,Amount
2026-08-04,PAYOUT,96.80
2026-09-02,PAYOUT,56.00`;

test('the report leads with what is worth chasing, ordered by money at stake', () => {
  const r = buildFullReport({ platformCsv: platform, bankCsv: bank });
  assert.match(r.actions[0], /do not appear in the bank file/);
  assert.equal(r.summary.unmatchedEarningsCount, 1);
});

test('a clean period says there is nothing to chase', () => {
  // Consistent fees as well as matched deposits: the shared fixture deliberately
  // contains a 30% fee outlier, so it is never "clean" even when every payout
  // lands. That is the report behaving correctly, not a false positive.
  const consistent = `id,Created,Amount,Fee,Net
ch_1,2026-08-01,100.00,3.20,96.80
ch_2,2026-08-05,250.00,8.00,242.00`;
  const clean = `Date,Description,Amount
2026-08-04,P,96.80
2026-08-12,P,242.00`;
  const r = buildFullReport({ platformCsv: consistent, bankCsv: clean });
  assert.deepEqual(r.actions, ['Nothing to chase. Everything in these files reconciles.']);
});

test('a period where every payout landed still reports a fee question if one exists', () => {
  const allLanded = `Date,Description,Amount
2026-08-04,P,96.80
2026-08-12,P,242.45
2026-08-20,P,56.00`;
  const r = buildFullReport({ platformCsv: platform, bankCsv: allLanded });
  assert.equal(r.summary.unmatchedEarningsCount, 0);
  assert.match(r.actions[0], /fees charged above your own median/,
    'money can reconcile perfectly and still have been charged inconsistently');
});

test('the effective fee rate is computed from the files, never assumed', () => {
  const fees = analyseFees([
    { grossCents: 10000, feeCents: 320 },
    { grossCents: 25000, feeCents: 755 }
  ]);
  assert.equal(fees.available, true);
  assert.equal(fees.totalFeeCents, 1075);
  assert.equal(fees.effectiveRatePct, Number(((1075 / 35000) * 100).toFixed(2)));
});

test('with no fee column the report says nothing about fees rather than guessing', () => {
  const r = buildFullReport({
    platformCsv: 'Date,Reference,Amount\n2026-08-01,A,500.00',
    bankCsv: 'Date,Description,Amount\n2026-08-03,P,500.00'
  });
  assert.equal(r.findings.fees.available, false);
  assert.match(r.findings.fees.reason, /No fee column/);
});

test('a fee outlier is raised as a question, never as an overcharge', () => {
  const r = buildFullReport({ platformCsv: platform, bankCsv: bank });
  const [outlier] = r.findings.fees.outliers;
  assert.equal(outlier.orderId, 'ch_3');
  assert.match(outlier.note, /worth checking why/);
  assert.equal(/overcharg|stole|owed to you/i.test(outlier.note), false);
});

test('a duplicated reference is flagged before any shortfall is believed', () => {
  const dupes = `id,Created,Amount,Fee,Net
ch_1,2026-08-01,100.00,3.20,96.80
ch_1,2026-08-01,100.00,3.20,96.80`;
  const r = buildFullReport({ platformCsv: dupes, bankCsv: 'Date,Description,Amount\n2026-08-04,P,96.80' });
  assert.equal(r.findings.duplicateEarnings.length, 1);
  assert.match(r.actions.join(' '), /duplicated reference\(s\).*before treating any shortfall as real/);
});

test('two identical same-day credits are surfaced without being called an error', () => {
  const { duplicateDeposits } = findDuplicates([], [
    { date: '2026-08-04', amountCents: 9680, rowNumber: 2 },
    { date: '2026-08-04', amountCents: 9680, rowNumber: 3 }
  ]);
  assert.equal(duplicateDeposits.length, 1);
  assert.match(duplicateDeposits[0].note, /Often genuinely two payouts/);
});

test('the report projects no recovery and estimates no saving', () => {
  const serialized = JSON.stringify(buildFullReport({ platformCsv: platform, bankCsv: bank })).toLowerCase();
  for (const word of ['estimat', 'projec', 'annual', 'you will recover', 'guarantee']) {
    assert.equal(serialized.includes(word), false, `the report must not contain "${word}"`);
  }
});

test('the limits are stated in the report itself, not only on the page that sold it', () => {
  const r = buildFullReport({ platformCsv: platform, bankCsv: bank });
  assert.match(r.limits, /not proof of loss/);
});

test('the rendered report is self-contained and escapes what came from the files', () => {
  const nasty = `Date,Reference,Net
2026-08-01,"<script>alert(1)</script>",50.00`;
  const html = renderReportHtml(buildFullReport({
    platformCsv: nasty, bankCsv: 'Date,Description,Amount\n2026-08-09,P,999.00'
  }));
  assert.equal(html.includes('<script>alert(1)</script>'), false, 'file content must never become markup');
  assert.match(html, /&lt;script&gt;/);
  assert.equal(/<link |<img |src="http/.test(html), false, 'the report must not depend on anything external');
});
