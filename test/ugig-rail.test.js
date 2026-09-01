import test from 'node:test';
import assert from 'node:assert/strict';
import { UgigRail, evaluateUgigFundingGate, normalizeUgigGig } from '../src/rails/ugig.js';

const FIXTURE_ID = '94b229d6-80af-4f9c-ba5b-52746ebb7787';

function gigFixture(overrides = {}) {
  return {
    id: FIXTURE_ID,
    title: 'Answer one factual question with cited sources — $5, 6h',
    description: 'Answer the bounded question and cite authoritative sources.',
    acceptance_criteria: 'One factual answer with citations delivered within six hours.',
    status: 'active',
    budget_min: 5,
    budget_max: 5,
    payment_coin: 'USDC',
    applications_count: 3,
    poster: {
      username: 'fixture-poster',
      reviews_count: 0,
      completed_gigs: 0,
      wallet_currencies: []
    },
    ...overrides
  };
}

function paidInvoice(overrides = {}) {
  return {
    id: 'invoice-1',
    gig_id: FIXTURE_ID,
    amount_usd: 5,
    currency: 'USDC',
    status: 'paid',
    coinpay_invoice_id: 'coinpay-1',
    ...overrides
  };
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data)
  };
}

test('normalizes a live-shaped uGig fixture as an immediate-income candidate', () => {
  const candidate = normalizeUgigGig(gigFixture());
  assert.equal(candidate.id, FIXTURE_ID);
  assert.equal(candidate.profile, 'immediate_income_v1');
  assert.deepEqual(candidate.reward, { amount: 5, currency: 'USDC' });
  assert.equal(candidate.taskOpen, true);
});

test('preserves observed application count without treating it as funding evidence', () => {
  const candidate = normalizeUgigGig(gigFixture());
  const gate = evaluateUgigFundingGate(candidate, { application: { status: 'accepted' } });
  assert.equal(candidate.applicationCount, 3);
  assert.equal(gate.classification, 'NEEDS_EVIDENCE');
  assert.ok(gate.missingEvidence.includes('invoice'));
});

test('accepted engagement without an invoice is never executable', () => {
  const candidate = normalizeUgigGig(gigFixture());
  const gate = evaluateUgigFundingGate(candidate, {
    application: { status: 'accepted' },
    walletCapabilities: { 'wallet.receive_usdc': true }
  });
  assert.equal(gate.engagementExists, true);
  assert.equal(gate.fundingVerified, false);
  assert.equal(gate.executable, false);
  assert.equal(gate.classification, 'NEEDS_EVIDENCE');
});

test('a paid invoice with provider evidence advances payout certainty', () => {
  const candidate = normalizeUgigGig(gigFixture({
    poster: { username: 'established', reviews_count: 5, completed_gigs: 3, wallet_currencies: ['USDC'] }
  }));
  const gate = evaluateUgigFundingGate(candidate, {
    application: { status: 'accepted' },
    invoices: [paidInvoice()],
    walletCapabilities: { 'wallet.receive_usdc': true },
    acceptanceProbability: 0.9,
    aiToolCostUsd: 0.5
  });
  assert.equal(gate.fundingVerified, true);
  assert.equal(gate.classification, 'EXECUTABLE');
});

test('weak poster evidence down-ranks expected value', () => {
  const weak = normalizeUgigGig(gigFixture());
  const strong = normalizeUgigGig(gigFixture({
    poster: { username: 'established', reviews_count: 8, completed_gigs: 4, wallet_currencies: ['USDC'] }
  }));
  const evidence = {
    application: { status: 'accepted' },
    invoices: [paidInvoice()],
    walletCapabilities: { 'wallet.receive_usdc': true },
    acceptanceProbability: 0.8
  };
  const weakGate = evaluateUgigFundingGate(weak, evidence);
  const strongGate = evaluateUgigFundingGate(strong, evidence);
  assert.equal(weakGate.posterRisk, 'high');
  assert.ok(weakGate.expectedValueUsd < strongGate.expectedValueUsd);
});

test('reward and expected value remain separate from verified revenue', () => {
  const candidate = normalizeUgigGig(gigFixture());
  const gate = evaluateUgigFundingGate(candidate, {
    application: { status: 'accepted' },
    invoices: [paidInvoice()],
    walletCapabilities: { 'wallet.receive_usdc': true }
  });
  assert.equal(candidate.reward.amount, 5);
  assert.equal(candidate.realizedRevenue.amount, 0);
  assert.equal(gate.economicTruth.verifiedRevenue, false);
  assert.equal(gate.economicTruth.realizedRevenueAmount, 0);
});

test('discovery and validation issue only GET requests', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.includes('/invoice')) return jsonResponse({ data: [] });
    return jsonResponse({ data: [gigFixture()], pagination: { total: 1 } });
  };
  const rail = new UgigRail({ apiKey: 'fixture-key', fetchImpl });
  const discovery = await rail.discover({ limit: 10 });
  const invoices = await rail.getInvoices(FIXTURE_ID);
  await rail.verify(discovery.candidates[0], { invoices: invoices.invoices });
  assert.equal(discovery.candidates.length, 1);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((call) => call.method === 'GET'));
  await assert.rejects(() => rail.apply(FIXTURE_ID), /blocked while rail is read-only/);
});

test('expected value subtracts AI and other tool costs', () => {
  const candidate = normalizeUgigGig(gigFixture({
    poster: { username: 'established', reviews_count: 5, completed_gigs: 3, wallet_currencies: ['USDC'] }
  }));
  const gate = evaluateUgigFundingGate(candidate, {
    application: { status: 'accepted' },
    invoices: [paidInvoice()],
    walletCapabilities: { 'wallet.receive_usdc': true },
    acceptanceProbability: 0.8,
    aiToolCostUsd: 1,
    otherToolCostUsd: 0.5
  });
  assert.equal(gate.toolCostUsd, 1.5);
  assert.equal(gate.expectedValueUsd, 2.5);
});

test('wallet mismatch blocks an otherwise funded engagement', () => {
  const candidate = normalizeUgigGig(gigFixture());
  const gate = evaluateUgigFundingGate(candidate, {
    application: { status: 'accepted' },
    invoices: [paidInvoice()],
    walletCapabilities: { 'wallet.receive_usdt': true }
  });
  assert.equal(gate.classification, 'BLOCKED');
  assert.ok(gate.blockers.includes('payout_wallet_incompatible'));
});

test('current fixture remains NEEDS_EVIDENCE unless authenticated funding proof exists', async () => {
  const rail = new UgigRail({ fetchImpl: async () => jsonResponse({ data: [] }) });
  const invoiceRead = await rail.getInvoices(FIXTURE_ID);
  const verification = await rail.verify(gigFixture(), {
    application: { status: 'accepted' },
    invoices: invoiceRead.invoices,
    walletCapabilities: { 'wallet.receive_usdc': true }
  });
  assert.equal(invoiceRead.blocked, true);
  assert.equal(verification.gate.classification, 'NEEDS_EVIDENCE');
  assert.equal(verification.gate.executable, false);
});
