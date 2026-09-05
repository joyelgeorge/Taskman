import test from 'node:test';
import assert from 'node:assert/strict';
import { instantAudit, matchPayouts } from '../src/instant-audit.js';

const platformCsv = `Date,Order,Type,Amount,Fee,Net,Currency
2026-08-01,FO123,Order,100.00,20.00,80.00,USD
2026-08-05,FO124,Order,250.00,50.00,200.00,USD
2026-08-12,FO125,Order,60.00,12.00,48.00,USD`;

const bankCsv = `Date,Description,Amount
2026-08-08,FIVERR PAYOUT FO123,80.00
2026-08-20,FIVERR PAYOUT FO125,48.00`;

test('the audit names the specific order that never landed, not just a variance', () => {
  const result = instantAudit({ platformCsv, bankCsv });
  assert.equal(result.ok, true);
  assert.equal(result.summary.unmatchedEarningsCount, 1);
  assert.equal(result.summary.unmatchedEarningsCents, 20000);
  const [missing] = result.findings.earningsWithNoDeposit;
  // An aggregate "$200 variance" persuades nobody. A named order they can check
  // against their own bank in a minute is the entire point.
  assert.equal(missing.orderId, 'FO124');
  assert.equal(missing.earnedOn, '2026-08-05');
  assert.match(result.headline, /\$200\.00/);
});

test('a clean set reconciles and says so, rather than manufacturing a problem', () => {
  const clean = `Date,Description,Amount
2026-08-08,PAYOUT,80.00
2026-08-10,PAYOUT,200.00
2026-08-20,PAYOUT,48.00`;
  const result = instantAudit({ platformCsv, bankCsv: clean });
  assert.equal(result.summary.unmatchedEarningsCount, 0);
  assert.match(result.headline, /Nothing is missing/);
  assert.equal(result.caveat, null);
});

test('a gap is framed as a question to ask, never as proof of loss', () => {
  const result = instantAudit({ platformCsv, bankCsv });
  assert.match(result.caveat, /not proof of loss/);
});

test('nothing from the upload is retained, and the response says so', () => {
  const result = instantAudit({ platformCsv, bankCsv });
  assert.match(result.retention, /discarded/);
});

test('no projected saving is reported — only what the files show', () => {
  const result = instantAudit({ platformCsv, bankCsv });
  const serialized = JSON.stringify(result).toLowerCase();
  assert.equal(serialized.includes('annual'), false, 'the audit must not project beyond the two files');
  assert.equal(serialized.includes('estimat'), false);
});

test('a deposit outside the match window is not silently credited', () => {
  const late = `Date,Description,Amount
2026-12-30,PAYOUT,80.00`;
  const result = instantAudit({ platformCsv, bankCsv: late });
  assert.equal(result.summary.matchedCount, 0, 'a deposit five months later is not evidence this order was paid');
});

test('one deposit cannot settle two identical orders', () => {
  const twin = `Date,Order,Type,Amount,Fee,Net,Currency
2026-08-01,A1,Order,100.00,20.00,80.00,USD
2026-08-02,A2,Order,100.00,20.00,80.00,USD`;
  const one = `Date,Description,Amount
2026-08-05,PAYOUT,80.00`;
  const result = instantAudit({ platformCsv: twin, bankCsv: one });
  assert.equal(result.summary.matchedCount, 1);
  assert.equal(result.summary.unmatchedEarningsCount, 1);
});

test('the closest deposit by date wins when several match the amount', () => {
  const { matched } = matchPayouts({
    transactions: [{ orderId: 'X', netCents: 5000, date: '2026-08-10' }],
    deposits: [
      { amountCents: 5000, date: '2026-09-01' },
      { amountCents: 5000, date: '2026-08-12' }
    ]
  });
  assert.equal(matched[0].depositedOn, '2026-08-12');
});

test('a malformed platform file is a clear answer, not a crash', () => {
  const result = instantAudit({ platformCsv: 'nope,not,a,statement\n1,2,3,4', bankCsv });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'platform_csv');
  assert.match(result.error, /missing required/i);
});

test('a missing file is refused before anything is parsed', () => {
  assert.throws(() => instantAudit({ platformCsv }), /Both a platform earnings CSV and a bank deposits CSV/);
});

// ---- the boot crash this route was blocked behind -----------------------------

test('a missing scenario seed does not stop the server from starting', async () => {
  // data/scenarios.json is untracked, so it is absent on every fresh checkout.
  // loadScenarioSeed threw ENOENT out of startup before the HTTP listener was
  // reached, so the server carrying every customer-facing route could not boot on
  // a clean deploy at all. A missing optional seed means no scenarios, never a
  // refusal to serve.
  const { loadScenarioSeed } = await import('../src/scenario-store.js');
  const seed = await loadScenarioSeed();
  assert.ok(seed && typeof seed === 'object');
  assert.ok(Array.isArray(seed.scenarios), 'an absent or empty seed must still yield a usable shape');
});
