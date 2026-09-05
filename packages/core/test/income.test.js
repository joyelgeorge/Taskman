import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerStream, setStreamState, markStreamSettled, listStreams, streamPortfolio,
  resetIncomeMemory, STREAM_STATES
} from '../income/streams.js';
import {
  registerDataProduct, listDataProducts, appraise, resetDataProductMemory
} from '../income/data-products.js';
import { seedIncomeStreams, incomeReport } from '../income/index.js';

async function reset() { await resetIncomeMemory(); await resetDataProductMemory(); }

const stream = (over = {}) => ({
  streamKey: 's1', title: 'A stream',
  mechanism: 'Client pays by bank transfer.',
  requires: 'One client.',
  nextAction: 'Find the client.',
  unblockedBy: 'human',
  ...over
});

// ---- streams ----------------------------------------------------------------

test('a stream must say how money physically arrives', async () => {
  await reset();
  await assert.rejects(() => registerStream({ ...stream(), mechanism: '' }), /mechanism is required/);
});

test('a stream that cannot be disproven is rejected', async () => {
  await reset();
  await assert.rejects(() => registerStream({ ...stream(), requires: '' }), /cannot be disproven/);
});

test('a stream must name who can unblock it', async () => {
  await reset();
  await assert.rejects(() => registerStream({ ...stream(), unblockedBy: 'someone' }), /unblockedBy must be/);
});

test('EARNING can never be set by hand — only a settlement moves a stream there', async () => {
  await reset();
  await registerStream(stream());
  await assert.rejects(() => setStreamState('s1', STREAM_STATES.EARNING), /only by markStreamSettled/);
});

test('a settlement without an external reference does not move a stream to EARNING', async () => {
  await reset();
  await registerStream(stream());
  await assert.rejects(() => markStreamSettled('s1', { externalRef: '' }), /externalRef is required/);
  assert.equal((await listStreams({}))[0].state, STREAM_STATES.HYPOTHESIS);
});

test('a verified settlement moves the stream to EARNING and records the reference', async () => {
  await reset();
  await registerStream(stream());
  const moved = await markStreamSettled('s1', { externalRef: 'txn_1', settledAt: '2026-09-05T00:00:00Z' });
  assert.equal(moved.state, STREAM_STATES.EARNING);
  assert.ok(moved.firstSettledAt);
  assert.ok(moved.evidence.some(e => e.externalRef === 'txn_1'));
});

test('re-seeding never overwrites a state the evidence already moved', async () => {
  await reset();
  await registerStream(stream());
  await setStreamState('s1', STREAM_STATES.DISPROVEN, { reason: 'measured zero volume' });
  await registerStream({ ...stream(), state: STREAM_STATES.HYPOTHESIS });
  const [found] = await listStreams({});
  assert.equal(found.state, STREAM_STATES.DISPROVEN, 'a disproven stream must not be resurrected by a re-seed');
});

test('the portfolio never offers a human-blocked stream as the next action', async () => {
  await reset();
  await registerStream(stream({ streamKey: 'blocked', unblockedBy: 'human', testCostHours: 1 }));
  await registerStream(stream({
    streamKey: 'doable', unblockedBy: 'machine', testCostHours: 9, nextAction: 'Collect the series.'
  }));
  const portfolio = await streamPortfolio();
  assert.equal(portfolio.nextAction, 'Collect the series.',
    'a cheaper test that no machine can perform must not outrank work the machine can actually do');
  assert.equal(portfolio.waitingOnHuman.length, 1);
  assert.equal(portfolio.anySettled, false);
});

test('the cheapest machine-actionable test comes first', async () => {
  await reset();
  await registerStream(stream({ streamKey: 'slow', unblockedBy: 'machine', testCostHours: 40, nextAction: 'Slow.' }));
  await registerStream(stream({ streamKey: 'fast', unblockedBy: 'machine', testCostHours: 2, nextAction: 'Fast.' }));
  assert.equal((await streamPortfolio()).nextAction, 'Fast.');
});

// ---- data products ----------------------------------------------------------

const product = (over = {}) => ({
  productKey: 'p1', title: 'A dataset', buyer: 'Someone', decision: 'Something',
  seriesKeys: ['a.b'], reconstructible: false, ...over
});

test('a dataset with no named buyer is not a product', async () => {
  await reset();
  await assert.rejects(() => registerDataProduct({ ...product(), buyer: '' }), /buyer is required/);
});

test('a dataset that changes no decision has no price', async () => {
  await reset();
  await assert.rejects(() => registerDataProduct({ ...product(), decision: '' }), /changes no decision/);
});

test('the moat test must be answered explicitly, not defaulted', async () => {
  await reset();
  await assert.rejects(() => registerDataProduct({ ...product(), reconstructible: undefined }),
    /reconstructible must be checked explicitly/);
});

test('a reconstructible series is never sellable, however long it has run', () => {
  const verdict = appraise({ reconstructible: true, resalePermitted: true, observationDays: 5000 });
  assert.equal(verdict.sellable, false);
  assert.match(verdict.blockers.join(' '), /backfill it free/);
});

test('an unreconstructible series is still not sellable until it has real coverage', () => {
  const verdict = appraise({ reconstructible: false, resalePermitted: true, observationDays: 10 });
  assert.equal(verdict.sellable, false);
  assert.match(verdict.blockers.join(' '), /10 of 365 days/);
});

test('coverage, resale rights and an unarchived source together make it sellable', () => {
  const verdict = appraise({ reconstructible: false, resalePermitted: true, observationDays: 400 });
  assert.equal(verdict.sellable, true);
  assert.deepEqual(verdict.blockers, []);
  assert.equal(verdict.valuation, null, 'no price is invented for a buyer this system has not met');
});

// ---- the seeded portfolio ----------------------------------------------------

test('seeding records both the earning hypotheses and the dataset that is worth nothing', async () => {
  await reset();
  await seedIncomeStreams();
  const streams = await listStreams({});
  assert.ok(streams.length >= 5);
  assert.equal(streams.find(s => s.streamKey === 'agent-task-boards').state, STREAM_STATES.DISPROVEN);
  const products = await listDataProducts();
  const ecb = products.find(p => p.productKey === 'ecb-fx-daily');
  assert.equal(ecb.reconstructible, true, 'the ECB series must be recorded as reconstructible — it is');
  const hn = products.find(p => p.productKey === 'hn-frontpage-history');
  assert.equal(hn.reconstructible, false);
});

test('the report states plainly that nothing has settled', async () => {
  await reset();
  const report = await incomeReport({});
  assert.equal(report.anySettled, false);
  assert.match(report.verdict, /Nothing has settled yet/);
  assert.ok(report.actionable.length >= 1, 'at least one lane must be machine-actionable tonight');
  assert.ok(report.waitingOnHuman.length >= 1);
});
