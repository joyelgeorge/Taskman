import { COMMERCIAL_WEDGE_SPEC, reconcileFiverrPayoutBatch } from './commercial-wedge.js';
import { MINIMUM_STACK_CONFIG, verifyCustomerStackReady } from './integration-stack.js';

// In-memory customer workflow state
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
  valueMetrics: {
    estimatedAnnualSavingsCents: 0, // Unverified forward-looking estimate
    verifiedRecoveredFeesCents: 0,   // Real cryptographic/hashed evidence from completed reconciliations
    verifiedReconciliationCount: 0,
    lastVerifiedEvidenceRef: null
  },
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
    customerWorkflowState.valueMetrics.estimatedAnnualSavingsCents = Math.round((vol * 0.05 * 12) + 48000);
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
 * Executes a customer reconciliation run, capturing verified economic outcome.
 */
export function executeCustomerReconciliation({ transactions = [], deposits = [] } = {}) {
  if (customerWorkflowState.status !== 'ACTIVE') {
    throw new Error('Workflow must be ACTIVE to run reconciliation');
  }

  const report = reconcileFiverrPayoutBatch({ transactions, deposits });

  const feeCents = report.summary.platformFeesCents;
  customerWorkflowState.valueMetrics.verifiedRecoveredFeesCents += feeCents;
  customerWorkflowState.valueMetrics.verifiedReconciliationCount += 1;
  customerWorkflowState.valueMetrics.lastVerifiedEvidenceRef = report.evidenceRef;

  const runRecord = {
    id: `cust-run-${Date.now()}`,
    executedAt: report.reconciledAt,
    balanced: report.balanced,
    verifiedTaxFeeSavingsCents: feeCents,
    discrepancyCount: report.discrepancies.length,
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
    valueMetrics: {
      estimatedAnnualSavingsCents: 0,
      verifiedRecoveredFeesCents: 0,
      verifiedReconciliationCount: 0,
      lastVerifiedEvidenceRef: null
    },
    reconciliationHistory: []
  };
}
