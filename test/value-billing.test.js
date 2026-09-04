import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateValueLinkedBilling,
  transitionInvoiceCommercialState,
  getAccountBillableEvents,
  _resetValueBillingState,
  BILLING_RULES,
  INVOICEABLE_STATUSES
} from '../src/value-billing.js';

test.beforeEach(() => {
  _resetValueBillingState();
});

test('calculateValueLinkedBilling rejects unverified or estimated outcomes', () => {
  assert.throws(() => {
    calculateValueLinkedBilling({
      accountId: 'cust-1',
      outcomeEvidenceRef: 'fiverr-recon-123',
      evidenceType: BILLING_RULES.REQUIRED_EVIDENCE_TYPE,
      evidenceLevel: BILLING_RULES.MINIMUM_EVIDENCE_LEVEL,
      isEstimated: true,
      verifiedRecoveredFeeCents: 5000
    });
  }, /Estimated value cannot produce a billable event/);
});

test('calculateValueLinkedBilling enforces explicit evidence type and cryptographic level', () => {
  assert.throws(() => {
    calculateValueLinkedBilling({
      accountId: 'cust-1',
      outcomeEvidenceRef: 'fiverr-recon-123',
      evidenceType: 'unverified_note',
      evidenceLevel: BILLING_RULES.MINIMUM_EVIDENCE_LEVEL,
      verifiedRecoveredFeeCents: 5000
    });
  }, /Invalid evidenceType/);

  assert.throws(() => {
    calculateValueLinkedBilling({
      accountId: 'cust-1',
      outcomeEvidenceRef: 'fiverr-recon-123',
      evidenceType: BILLING_RULES.REQUIRED_EVIDENCE_TYPE,
      evidenceLevel: 'LOW_CONFIDENCE',
      verifiedRecoveredFeeCents: 5000
    });
  }, /Invalid evidenceLevel/);
});

test('calculateValueLinkedBilling produces deterministic calculation and separates concepts', () => {
  const { idempotentReplay, event } = calculateValueLinkedBilling({
    accountId: 'agency-alpha',
    outcomeEvidenceRef: 'fiverr-recon-hash-999',
    evidenceType: 'hashed_audit_report',
    evidenceLevel: 'VERIFIED_CRYPTOGRAPHIC_AUDIT',
    verifiedRecoveredFeeCents: 10000, // $100.00 recovered fees
    batchCount: 2
  });

  assert.equal(idempotentReplay, false);
  assert.equal(event.accountId, 'agency-alpha');
  assert.equal(event.breakdown.batchFeeCents, 400); // 2 * $2.00 = $4.00
  assert.equal(event.breakdown.performanceFeeCents, 500); // 5% of $100 = $5.00
  assert.equal(event.invoiceableAmountCents, 900); // $9.00 total
  assert.equal(event.verifiedEconomicValueCreatedCents, 10000); // $100.00 verified value
  assert.equal(event.cashCollectedCents, 0); // cash not yet collected
  assert.equal(event.invoiceStatus, INVOICEABLE_STATUSES.INVOICEABLE);
});

test('replaying the same verified outcome cannot double-bill (idempotent)', () => {
  const first = calculateValueLinkedBilling({
    accountId: 'agency-alpha',
    outcomeEvidenceRef: 'fiverr-recon-hash-unique',
    evidenceType: 'hashed_audit_report',
    evidenceLevel: 'VERIFIED_CRYPTOGRAPHIC_AUDIT',
    verifiedRecoveredFeeCents: 5000,
    batchCount: 1
  });

  assert.equal(first.idempotentReplay, false);

  const second = calculateValueLinkedBilling({
    accountId: 'agency-alpha',
    outcomeEvidenceRef: 'fiverr-recon-hash-unique',
    evidenceType: 'hashed_audit_report',
    evidenceLevel: 'VERIFIED_CRYPTOGRAPHIC_AUDIT',
    verifiedRecoveredFeeCents: 5000,
    batchCount: 1
  });

  assert.equal(second.idempotentReplay, true);
  assert.equal(second.alreadyBilled, true);
  assert.equal(second.event.id, first.event.id);
});

test('commercial states transition explicitly (invoice, collect, dispute, refund)', () => {
  const { event } = calculateValueLinkedBilling({
    accountId: 'agency-beta',
    outcomeEvidenceRef: 'fiverr-recon-hash-state',
    evidenceType: 'hashed_audit_report',
    evidenceLevel: 'VERIFIED_CRYPTOGRAPHIC_AUDIT',
    verifiedRecoveredFeeCents: 6000,
    batchCount: 1
  });

  assert.equal(event.invoiceStatus, INVOICEABLE_STATUSES.INVOICEABLE);
  assert.equal(event.cashCollectedCents, 0);

  // Collect cash
  const paid = transitionInvoiceCommercialState({
    outcomeEvidenceRef: 'fiverr-recon-hash-state',
    targetStatus: INVOICEABLE_STATUSES.PAID
  });
  assert.equal(paid.invoiceStatus, INVOICEABLE_STATUSES.PAID);
  assert.equal(paid.cashCollectedCents, event.invoiceableAmountCents);

  // Refund / dispute handling
  const disputed = transitionInvoiceCommercialState({
    outcomeEvidenceRef: 'fiverr-recon-hash-state',
    targetStatus: INVOICEABLE_STATUSES.DISPUTED,
    reason: 'Client questioned fee variance rate'
  });
  assert.equal(disputed.invoiceStatus, INVOICEABLE_STATUSES.DISPUTED);
  assert.equal(disputed.disputeReason, 'Client questioned fee variance rate');
});
