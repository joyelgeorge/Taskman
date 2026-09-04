import { COMMERCIAL_WEDGE_SPEC } from './commercial-wedge.js';
import { BILLABLE_METRICS, recordMeterEvent } from './metering.js';
import { createHash } from 'node:crypto';

export const BILLING_RULES = Object.freeze({
  VERSION: 1,
  CURRENCY: 'USD',
  PRICING_MODEL: 'HYBRID_BASE_PERFORMANCE', // Base $19/mo + $2/reconciliation batch + 5% of verified tax/fee leakage recovered capped at $50/mo
  BASE_MONTHLY_CENTS: 1900,               // $19.00
  BATCH_FEE_CENTS: 200,                   // $2.00
  PERFORMANCE_PERCENTAGE: 0.05,           // 5% of verified recovered fees
  MAX_MONTHLY_PERFORMANCE_FEE_CENTS: 5000,// $50.00 cap
  REQUIRED_EVIDENCE_TYPE: 'hashed_audit_report',
  MINIMUM_EVIDENCE_LEVEL: 'VERIFIED_CRYPTOGRAPHIC_AUDIT'
});

export const INVOICEABLE_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_CUSTOMER_APPROVAL: 'PENDING_CUSTOMER_APPROVAL',
  INVOICEABLE: 'INVOICEABLE',
  INVOICED: 'INVOICED',
  PAID: 'PAID',
  DISPUTED: 'DISPUTED',
  CREDITED: 'CREDITED',
  REFUNDED: 'REFUNDED'
});

// In-memory store of commercial invoiceable events / ledgers
const billedOutcomes = new Map(); // outcomeEvidenceRef -> invoiceableEvent
const accountInvoices = new Map(); // invoiceId -> invoiceRecord

/**
 * Calculates a deterministic invoiceable amount for a verified economic outcome.
 * Prevents double-billing and rejects unverified or estimated outcomes.
 */
export function calculateValueLinkedBilling({
  accountId = 'default-customer',
  outcomeEvidenceRef,
  evidenceType,
  evidenceLevel,
  isEstimated = false,
  verifiedRecoveredFeeCents = 0,
  batchCount = 1,
  pricingVersion = BILLING_RULES.VERSION
} = {}) {
  if (!accountId || typeof accountId !== 'string') {
    throw new Error('accountId is required for billing calculation');
  }

  if (!outcomeEvidenceRef || typeof outcomeEvidenceRef !== 'string') {
    throw new Error('outcomeEvidenceRef is required for billing calculation');
  }

  // Acceptance Criterion: Estimated opportunity value cannot create a billable event
  if (isEstimated) {
    throw new Error('Estimated value cannot produce a billable event. Must be verified evidence.');
  }

  // Acceptance Criterion: Billable trigger and evidence requirements are explicit
  if (evidenceType !== BILLING_RULES.REQUIRED_EVIDENCE_TYPE) {
    throw new Error(`Invalid evidenceType '${evidenceType}'; required '${BILLING_RULES.REQUIRED_EVIDENCE_TYPE}'`);
  }

  if (evidenceLevel !== BILLING_RULES.MINIMUM_EVIDENCE_LEVEL) {
    throw new Error(`Invalid evidenceLevel '${evidenceLevel}'; required '${BILLING_RULES.MINIMUM_EVIDENCE_LEVEL}'`);
  }

  // Acceptance Criterion: Replaying the same verified outcome cannot double-bill
  if (billedOutcomes.has(outcomeEvidenceRef)) {
    const existing = billedOutcomes.get(outcomeEvidenceRef);
    return {
      idempotentReplay: true,
      alreadyBilled: true,
      event: existing
    };
  }

  // Deterministic calculation
  const batches = Math.max(1, Math.floor(Number(batchCount) || 1));
  const batchChargeCents = batches * BILLING_RULES.BATCH_FEE_CENTS;
  
  const rawPerfFee = Math.round((Number(verifiedRecoveredFeeCents) || 0) * BILLING_RULES.PERFORMANCE_PERCENTAGE);
  const performanceFeeCents = Math.min(rawPerfFee, BILLING_RULES.MAX_MONTHLY_PERFORMANCE_FEE_CENTS);

  const totalInvoiceableAmountCents = batchChargeCents + performanceFeeCents;

  const eventId = `billable_${createHash('sha256').update(`${accountId}:${outcomeEvidenceRef}:${pricingVersion}`).digest('hex').slice(0, 16)}`;

  const billableEvent = {
    id: eventId,
    accountId,
    pricingVersion,
    currency: BILLING_RULES.CURRENCY,
    outcomeEvidenceRef,
    evidenceLevel,
    evidenceType,
    breakdown: {
      batches,
      batchFeeCents: batchChargeCents,
      verifiedRecoveredFeeCents,
      performanceFeePercentage: BILLING_RULES.PERFORMANCE_PERCENTAGE,
      performanceFeeCents,
      totalInvoiceableAmountCents
    },
    // Separation of concepts:
    verifiedEconomicValueCreatedCents: verifiedRecoveredFeeCents,
    invoiceableAmountCents: totalInvoiceableAmountCents,
    invoiceStatus: INVOICEABLE_STATUSES.INVOICEABLE,
    cashCollectedCents: 0,
    generatedAt: new Date().toISOString(),
    disputeReason: null,
    refundReason: null
  };

  billedOutcomes.set(outcomeEvidenceRef, billableEvent);
  return {
    idempotentReplay: false,
    alreadyBilled: false,
    event: billableEvent
  };
}

/**
 * Transition the commercial state of an invoiceable event (e.g. invoice, collect cash, dispute, credit, refund).
 */
export function transitionInvoiceCommercialState({
  outcomeEvidenceRef,
  targetStatus,
  amountCollectedCents = 0,
  reason = ''
} = {}) {
  const event = billedOutcomes.get(outcomeEvidenceRef);
  if (!event) {
    throw new Error(`No billable event found for evidenceRef '${outcomeEvidenceRef}'`);
  }

  if (!Object.values(INVOICEABLE_STATUSES).includes(targetStatus)) {
    throw new Error(`Unknown targetStatus '${targetStatus}'`);
  }

  event.invoiceStatus = targetStatus;
  if (targetStatus === INVOICEABLE_STATUSES.PAID) {
    event.cashCollectedCents = amountCollectedCents > 0 ? amountCollectedCents : event.invoiceableAmountCents;
  } else if (targetStatus === INVOICEABLE_STATUSES.DISPUTED) {
    event.disputeReason = reason || 'Customer flagged reconciliation discrepancy';
  } else if (targetStatus === INVOICEABLE_STATUSES.REFUNDED || targetStatus === INVOICEABLE_STATUSES.CREDITED) {
    event.refundReason = reason || 'Customer commercial credit/refund applied';
  }

  return event;
}

/**
 * Returns a summary of billable events for an account.
 */
export function getAccountBillableEvents(accountId) {
  const events = [];
  for (const event of billedOutcomes.values()) {
    if (!accountId || event.accountId === accountId) {
      events.push(event);
    }
  }
  return events;
}

/**
 * Resets billing state (for tests).
 */
export function _resetValueBillingState() {
  billedOutcomes.clear();
  accountInvoices.clear();
}
