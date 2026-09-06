import test from 'node:test';
import assert from 'node:assert/strict';
import { fulfilAuditOrder, effectiveHourlyRate, AUDIT_RAIL } from '../src/audit-fulfilment.js';
import { railEconomics, resetLedgerMemory, SETTLEMENT_STATUS } from '../src/money-ledger.js';
import { resetGovernorMemory } from '../src/rail-governor.js';
import { resetIncomeMemory, resetDataProductMemory, listStreams, STREAM_STATES } from '@taskman/core';

async function reset() {
  await resetLedgerMemory(); await resetGovernorMemory();
  await resetIncomeMemory(); await resetDataProductMemory();
}

const platformCsv = `id,Created,Amount,Fee,Net
ch_1,2026-08-01,500.00,14.50,485.50
ch_2,2026-08-05,500.00,14.50,485.50
ch_3,2026-08-09,3000.00,138.00,2862.00`;
const bankCsv = `Date,Description,Amount
2026-08-06,PAYOUT,485.50
2026-08-10,PAYOUT,485.50`;

const order = (over = {}) => ({
  platformCsv, bankCsv, source: 'stripe', externalRef: 'pi_1',
  grossCents: 2000, feeCents: 88, minutesSpent: 12, ...over
});

test('a paid order produces the deliverable, the settlement and the stream together', async () => {
  await reset();
  const result = await fulfilAuditOrder(order());
  assert.match(result.report.actions[0], /do not appear in the bank file/);
  assert.ok(result.html.includes('Payout reconciliation'));
  assert.equal(result.settlement.status, SETTLEMENT_STATUS.CLEARED);
  assert.equal(result.settlement.externalRef, 'pi_1');
  assert.equal(result.stream.state, STREAM_STATES.EARNING);
});

test('a payment this system cannot confirm outside itself is not revenue', async () => {
  await reset();
  await assert.rejects(() => fulfilAuditOrder(order({ source: 'self_reported' })),
    /source must be one of stripe, paypal, bank, manual_receipt/);
  assert.equal((await railEconomics()).length, 0, 'nothing may be booked from an unverifiable source');
});

test('a settlement with no external reference is refused', async () => {
  await reset();
  await assert.rejects(() => fulfilAuditOrder(order({ externalRef: '' })), /externalRef is required/);
});

test('delivery time is mandatory, because an unmeasured hour hides a loss', async () => {
  await reset();
  await assert.rejects(() => fulfilAuditOrder(order({ minutesSpent: 0 })), /minutesSpent is required/);
});

test('an undeliverable audit books no money at all', async () => {
  await reset();
  // Order matters: the report is built before anything is recorded. Taking a
  // payment and booking revenue for an audit that cannot be produced is the one
  // sequence that must never happen.
  await assert.rejects(
    () => fulfilAuditOrder(order({ platformCsv: 'nope,not,a,statement\n1,2,3,4' })),
    /column found/);
  assert.equal((await railEconomics()).length, 0);
  assert.equal((await listStreams({})).filter(s => s.state === STREAM_STATES.EARNING).length, 0);
});

test('a pending payment does not move the stream to EARNING', async () => {
  await reset();
  const result = await fulfilAuditOrder(order({ status: SETTLEMENT_STATUS.PENDING }));
  assert.equal(result.stream, null, 'money that has not cleared is not money');
  const earning = (await listStreams({})).filter(s => s.state === STREAM_STATES.EARNING);
  assert.equal(earning.length, 0);
});

test('replaying the same payment reference books it once, and does not error', async () => {
  await reset();
  // A processor retrying a webhook is ordinary, so a repeat must not fail — but
  // it must also not count the money twice. Both stores resolve this the same
  // way: memory returns the existing row, PostgreSQL upserts on
  // (source, external_ref). Idempotent, not rejected.
  const first = await fulfilAuditOrder(order({ externalRef: 'pi_dup' }));
  const second = await fulfilAuditOrder(order({ externalRef: 'pi_dup' }));
  assert.equal(second.settlement.id, first.settlement.id, 'the same payment is the same settlement');

  const econ = (await railEconomics()).find(e => e.rail === AUDIT_RAIL);
  assert.equal(econ.clearedCount, 1, 'one payment, one settlement');
  assert.equal(econ.clearedCents, first.settlement.netCents, 'and it is counted once');
});

test('the effective hourly rate is what decides whether to do this again', () => {
  assert.equal(effectiveHourlyRate({ netCents: 1912, minutesSpent: 12 }), 95.6);
  // The same price against a whole afternoon is a different business.
  assert.equal(effectiveHourlyRate({ netCents: 1912, minutesSpent: 240 }), 4.78);
  assert.equal(effectiveHourlyRate({ netCents: 1912, minutesSpent: 0 }), null);
});

test('a PayPal payment books as PayPal, not as a manual receipt', async () => {
  await reset();
  // The audit page sells through a PayPal link, and the ledger would have refused
  // the payment: source had to be stripe, bank or manual_receipt. Forcing a real
  // processor payment into manual_receipt — the cash-and-cheques category, where
  // the only record is one we wrote ourselves — understates evidence that is as
  // strong as Stripe's.
  const result = await fulfilAuditOrder(order({ source: 'paypal', externalRef: '8XY12345AB678901C' }));
  assert.equal(result.settlement.source, 'paypal');
  assert.equal(result.settlement.status, SETTLEMENT_STATUS.CLEARED);
  assert.equal(result.stream.state, STREAM_STATES.EARNING);
});
