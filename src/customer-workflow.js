import { COMMERCIAL_WEDGE_SPEC, reconcileFiverrPayoutBatch } from './commercial-wedge.js';
import { MINIMUM_STACK_CONFIG, verifyCustomerStackReady } from './integration-stack.js';
import { createHash } from 'node:crypto';

// In-memory customer workflow state implementing the 7-level economic taxonomy
let customerWorkflowState = {
  workflowId: COMMERCIAL_WEDGE_SPEC.id,
  workflowName: COMMERCIAL_WEDGE_SPEC.name,
  status: 'INACTIVE', // 'INACTIVE' | 'ACTIVE'
  activatedAt: null,
  configuredInputs: {
    agencyName: '',
    fiverrUsername: '',
    monthlyVolumeEstimate: 0,
    notificationEmail: ''
  },
  connectedIntegrations: {
    fiverrStatements: { connected: false, format: 'CSV' },
    bankDeposits: { connected: false, format: 'CSV/Plaid' },
    stripeBilling: { connected: false, accountLinked: false }
  },
  billingBasis: {
    pricingModel: 'MONTHLY_BASE_PLUS_BATCH',
    monthlyBasePrice: '$19.00',
    batchFee: '$2.00 / batch',
    terms: 'Only charged upon manual or scheduled batch execution; zero upfront lock-in.'
  },
  // Strict 7-level economic taxonomy:
  // 1. identified_discrepancy_cents
  // 2. reconciled_amount_cents (and categorized platform fees)
  // 3. estimated_savings_cents
  // 4. customer_confirmed_savings_cents
  // 5. verified_cash_recovered_cents
  // 6. invoiceable_amount_cents
  // 7. cash_collected_cents
  economicTaxonomy: {
    identifiedDiscrepancyCents: 0,
    reconciledAmountCents: 0,
    categorizedPlatformFeesCents: 0, // Classified expense / deduction, NOT recovered cash
    estimatedSavingsCents: 0,        // Forward-looking projection
    customerConfirmedSavingsCents: 0,// Real confirmed deduction/savings with user signoff
    verifiedCashRecoveredCents: 0,   // Real clawback/refund verified via bank/processor
    invoiceableAmountCents: 0,       // Lawful billing obligation
    cashCollectedCents: 0            // Stripe settlement verified
  },
  valueMetrics: {
    estimatedAnnualSavingsCents: 0,
    reconciledPlatformFeesCents: 0,  // Explicitly renamed from recovered fees
    customerConfirmedSavingsCents: 0,
    verifiedCashRecoveredCents: 0,
    reconciliationCount: 0,
    lastVerifiedEvidenceRef: null
  },
  confirmedOutcomes: [],
  reconciliationHistory: []
};

/**
 * Returns the current customer onboarding and workflow status.
 */
export function getCustomerWorkflowState() {
  const readiness = verifyCustomerStackReady();
  const isConfigured = Boolean(
    customerWorkflowState.configuredInputs.agencyName &&
    customerWorkflowState.configuredInputs.fiverrUsername
  );

  const blockers = [];
  if (!isConfigured) {
    blockers.push('Agency & Fiverr profile setup incomplete');
  }
  if (!customerWorkflowState.connectedIntegrations.fiverrStatements.connected) {
    blockers.push('Fiverr transaction statement source not connected or uploaded');
  }

  return {
    ...customerWorkflowState,
    isConfigured,
    stackReadiness: readiness,
    canActivate: blockers.length === 0,
    blockers
  };
}

/**
 * Updates customer onboarding configuration.
 */
export function configureCustomerWorkflow({
  agencyName,
  fiverrUsername,
  monthlyVolumeEstimate = 0,
  notificationEmail = ''
} = {}) {
  if (agencyName !== undefined) customerWorkflowState.configuredInputs.agencyName = String(agencyName).trim();
  if (fiverrUsername !== undefined) customerWorkflowState.configuredInputs.fiverrUsername = String(fiverrUsername).trim();
  if (monthlyVolumeEstimate !== undefined) {
    const vol = Number(monthlyVolumeEstimate) || 0;
    customerWorkflowState.configuredInputs.monthlyVolumeEstimate = vol;
    // No projected saving is derived here any more.
    //
    // This used to compute (volume * 5% * 12) + $480 and present it to a prospect
    // as `estimatedAnnualSavingsCents`. Both terms were invented: nothing has ever
    // measured a 5% leakage rate for this customer or any other, and the flat
    // addend has no origin at all. It is the same self-flattering arithmetic the
    // settlement ledger exists to forbid — only pointed outward, at someone
    // deciding whether to pay, which is worse than pointing it at ourselves.
    //
    // The honest number is the one the audit actually finds in their own files,
    // and it stays zero until a reconciliation produces it.
  }
  if (notificationEmail !== undefined) customerWorkflowState.configuredInputs.notificationEmail = String(notificationEmail).trim();

  return getCustomerWorkflowState();
}

/**
 * Connects or updates an integration status for the onboarding flow.
 */
export function setCustomerIntegration({ integration, connected = true } = {}) {
  if (customerWorkflowState.connectedIntegrations[integration]) {
    customerWorkflowState.connectedIntegrations[integration].connected = Boolean(connected);
  }
  return getCustomerWorkflowState();
}

/**
 * Activates or deactivates the customer workflow.
 */
export function setCustomerWorkflowActive(active = true) {
  const state = getCustomerWorkflowState();
  if (active && !state.canActivate) {
    throw new Error(`Cannot activate workflow while blockers exist: ${state.blockers.join(', ')}`);
  }

  customerWorkflowState.status = active ? 'ACTIVE' : 'INACTIVE';
  customerWorkflowState.activatedAt = active ? new Date().toISOString() : null;
  return getCustomerWorkflowState();
}

/**
 * Executes a customer reconciliation run, capturing reconciled evidence.
 * Strict Economic Truth: Platform fees are itemized/categorized, NOT recovered cash.
 */
export function executeCustomerReconciliation({ transactions = [], deposits = [] } = {}) {
  if (customerWorkflowState.status !== 'ACTIVE') {
    throw new Error('Workflow must be ACTIVE to run reconciliation');
  }

  const report = reconcileFiverrPayoutBatch({ transactions, deposits });

  const feeCents = report.summary.platformFeesCents;
  const grossCents = report.summary.grossEarningsCents;
  const discrepancyCents = Math.abs(report.summary.deltaCents || 0);

  // Update economic taxonomy
  customerWorkflowState.economicTaxonomy.reconciledAmountCents += grossCents;
  customerWorkflowState.economicTaxonomy.categorizedPlatformFeesCents += feeCents;
  customerWorkflowState.economicTaxonomy.identifiedDiscrepancyCents += discrepancyCents;

  // Notice: verifiedCashRecoveredCents remains 0 until confirmed and recovered
  customerWorkflowState.valueMetrics.reconciledPlatformFeesCents += feeCents;
  customerWorkflowState.valueMetrics.reconciliationCount += 1;
  customerWorkflowState.valueMetrics.lastVerifiedEvidenceRef = report.evidenceRef;

  const runRecord = {
    id: `cust-run-${Date.now()}`,
    executedAt: report.reconciledAt,
    balanced: report.balanced,
    grossEarningsCents: grossCents,
    categorizedPlatformFeesCents: feeCents,
    identifiedDiscrepancyCents: discrepancyCents,
    confirmedSavingsCents: 0,
    evidenceRef: report.evidenceRef,
    summary: report.summary,
    discrepancies: report.discrepancies
  };

  customerWorkflowState.reconciliationHistory.unshift(runRecord);
  if (customerWorkflowState.reconciliationHistory.length > 50) {
    customerWorkflowState.reconciliationHistory.pop();
  }

  return {
    report,
    state: getCustomerWorkflowState()
  };
}

/**
 * Confirms a specific quantified outcome (e.g. tax deduction applied or bank fee dispute resolved).
 * Binds confirmation to tenant, run, immutable evidence digest, and actor.
 */
export function confirmCustomerOutcome({
  runId,
  outcomeType = 'CONFIRMED_TAX_DEDUCTION', // 'CONFIRMED_TAX_DEDUCTION' | 'VERIFIED_CASH_RECOVERY'
  confirmedAmountCents = 0,
  actor = 'customer_admin',
  reason = 'Customer reviewed and accepted reconciliation audit breakdown'
} = {}) {
  const run = customerWorkflowState.reconciliationHistory.find(r => r.id === runId);
  if (!run) {
    throw new Error(`Reconciliation run '${runId}' not found for confirmation`);
  }

  const amount = Math.max(0, Math.round(Number(confirmedAmountCents) || 0));
  if (amount <= 0) {
    throw new Error('confirmedAmountCents must be greater than 0');
  }

  const digest = createHash('sha256')
    .update(`${run.id}:${run.evidenceRef}:${outcomeType}:${amount}:${actor}`)
    .digest('hex');

  const confirmationRecord = {
    confirmationId: `conf_${digest.slice(0, 16)}`,
    runId,
    evidenceRef: run.evidenceRef,
    digest,
    outcomeType,
    confirmedAmountCents: amount,
    actor,
    reason,
    confirmedAt: new Date().toISOString()
  };

  run.confirmedSavingsCents = amount;

  if (outcomeType === 'VERIFIED_CASH_RECOVERY') {
    customerWorkflowState.economicTaxonomy.verifiedCashRecoveredCents += amount;
    customerWorkflowState.valueMetrics.verifiedCashRecoveredCents += amount;
  } else {
    customerWorkflowState.economicTaxonomy.customerConfirmedSavingsCents += amount;
    customerWorkflowState.valueMetrics.customerConfirmedSavingsCents += amount;
  }

  customerWorkflowState.confirmedOutcomes.unshift(confirmationRecord);

  return {
    confirmation: confirmationRecord,
    state: getCustomerWorkflowState()
  };
}

/**
 * Resets workflow state (for testing).
 */
export function _resetCustomerWorkflowState() {
  customerWorkflowState = {
    workflowId: COMMERCIAL_WEDGE_SPEC.id,
    workflowName: COMMERCIAL_WEDGE_SPEC.name,
    status: 'INACTIVE',
    activatedAt: null,
    configuredInputs: {
      agencyName: '',
      fiverrUsername: '',
      monthlyVolumeEstimate: 0,
      notificationEmail: ''
    },
    connectedIntegrations: {
      fiverrStatements: { connected: false, format: 'CSV' },
      bankDeposits: { connected: false, format: 'CSV/Plaid' },
      stripeBilling: { connected: false, accountLinked: false }
    },
    billingBasis: {
      pricingModel: 'MONTHLY_BASE_PLUS_BATCH',
      monthlyBasePrice: '$19.00',
      batchFee: '$2.00 / batch',
      terms: 'Only charged upon manual or scheduled batch execution; zero upfront lock-in.'
    },
    economicTaxonomy: {
      identifiedDiscrepancyCents: 0,
      reconciledAmountCents: 0,
      categorizedPlatformFeesCents: 0,
      estimatedSavingsCents: 0,
      customerConfirmedSavingsCents: 0,
      verifiedCashRecoveredCents: 0,
      invoiceableAmountCents: 0,
      cashCollectedCents: 0
    },
    valueMetrics: {
      estimatedAnnualSavingsCents: 0,
      reconciledPlatformFeesCents: 0,
      customerConfirmedSavingsCents: 0,
      verifiedCashRecoveredCents: 0,
      reconciliationCount: 0,
      lastVerifiedEvidenceRef: null
    },
    confirmedOutcomes: [],
    reconciliationHistory: []
  };
}
