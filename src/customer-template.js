import { COMMERCIAL_WEDGE_SPEC, reconcileFiverrPayoutBatch } from './commercial-wedge.js';
import { BILLING_RULES } from './value-billing.js';
import { MINIMUM_STACK_CONFIG, verifyCustomerStackReady } from './integration-stack.js';

export const REUSABLE_CUSTOMER_TEMPLATE_SPEC = Object.freeze({
  templateId: 'fiverr_agency_reconciliation_template_v1',
  version: 1,
  name: 'Fiverr Freelance Payout & Statement Reconciliation',
  description: 'Turnkey deployment template for boutique digital agencies to reconcile platform statements against bank accounts',
  wedgeId: COMMERCIAL_WEDGE_SPEC.id,
  requiredIntegrations: ['fiverrStatements', 'bankDeposits'],
  optionalIntegrations: ['stripeBilling'],
  pricingModel: BILLING_RULES.PRICING_MODEL,
  pricingVersion: BILLING_RULES.VERSION,
  defaultConfig: {
    monthlyVolumeEstimate: 5000,
    notificationSchedule: 'WEEKLY',
    autoReconcileOnUpload: true
  },
  manualWorkPoints: [
    {
      step: 'Statement CSV download from Fiverr',
      type: 'MANUAL_PORTAL_EXPORT',
      mitigationPlan: 'Provide direct Fiverr statement export guide link or browser extension helper'
    },
    {
      step: 'Bank statement CSV or Plaid credential link',
      type: 'BANK_CREDENTIAL_SETUP',
      mitigationPlan: 'Support instant bank CSV drag-and-drop before configuring open-banking Plaid sync'
    }
  ]
});

// Multi-tenant customer instance repository
const customerInstances = new Map(); // instanceId -> instanceRecord

/**
 * Instantiates the versioned customer template for a new tenant/customer.
 */
export function instantiateCustomerTemplate({
  instanceId,
  tenantId = 'default-tenant',
  agencyName,
  fiverrUsername,
  monthlyVolumeEstimate = REUSABLE_CUSTOMER_TEMPLATE_SPEC.defaultConfig.monthlyVolumeEstimate,
  notificationEmail = '',
  autoReconcileOnUpload = true
} = {}) {
  if (!instanceId || typeof instanceId !== 'string') {
    throw new Error('instanceId is required to instantiate customer template');
  }

  if (!agencyName || !fiverrUsername) {
    throw new Error('agencyName and fiverrUsername are required to instantiate customer template');
  }

  if (customerInstances.has(instanceId)) {
    throw new Error(`Customer instance '${instanceId}' already exists`);
  }

  const instance = {
    instanceId,
    tenantId,
    templateId: REUSABLE_CUSTOMER_TEMPLATE_SPEC.templateId,
    templateVersion: REUSABLE_CUSTOMER_TEMPLATE_SPEC.version,
    agencyName: String(agencyName).trim(),
    fiverrUsername: String(fiverrUsername).trim(),
    monthlyVolumeEstimate: Number(monthlyVolumeEstimate) || 0,
    notificationEmail: String(notificationEmail).trim(),
    autoReconcileOnUpload: Boolean(autoReconcileOnUpload),
    status: 'CONFIGURED', // 'CONFIGURED' | 'READY' | 'ACTIVE' | 'PAUSED'
    integrations: {
      fiverrStatements: false,
      bankDeposits: false,
      stripeBilling: false
    },
    createdAt: new Date().toISOString(),
    activatedAt: null,
    metrics: {
      totalBatchesRun: 0,
      totalVerifiedFeeRecoveryCents: 0,
      lastEvidenceRef: null
    },
    history: []
  };

  customerInstances.set(instanceId, instance);
  return instance;
}

/**
 * Validates readiness of a specific customer instance.
 */
export function verifyInstanceReadiness(instanceId) {
  const instance = customerInstances.get(instanceId);
  if (!instance) throw new Error(`Customer instance '${instanceId}' not found`);

  const blockers = [];
  if (!instance.integrations.fiverrStatements) {
    blockers.push('Missing fiverrStatements integration');
  }
  if (!instance.integrations.bankDeposits) {
    blockers.push('Missing bankDeposits integration');
  }

  const stackReady = verifyCustomerStackReady();
  const ready = blockers.length === 0;

  return {
    instanceId,
    ready,
    blockers,
    stackReady,
    status: ready ? 'READY' : 'INCOMPLETE'
  };
}

/**
 * Updates integrations for an instance.
 */
export function setInstanceIntegration(instanceId, integration, connected = true) {
  const instance = customerInstances.get(instanceId);
  if (!instance) throw new Error(`Customer instance '${instanceId}' not found`);

  if (integration in instance.integrations) {
    instance.integrations[integration] = Boolean(connected);
  }

  const readiness = verifyInstanceReadiness(instanceId);
  if (readiness.ready && instance.status === 'CONFIGURED') {
    instance.status = 'READY';
  } else if (!readiness.ready && instance.status === 'READY') {
    instance.status = 'CONFIGURED';
  }

  return instance;
}

/**
 * Activates or pauses an instance.
 */
export function setInstanceActive(instanceId, active = true) {
  const instance = customerInstances.get(instanceId);
  if (!instance) throw new Error(`Customer instance '${instanceId}' not found`);

  const readiness = verifyInstanceReadiness(instanceId);
  if (active && !readiness.ready) {
    throw new Error(`Cannot activate instance with blockers: ${readiness.blockers.join(', ')}`);
  }

  instance.status = active ? 'ACTIVE' : 'PAUSED';
  instance.activatedAt = active ? new Date().toISOString() : null;
  return instance;
}

/**
 * Runs reconciliation for an isolated tenant instance.
 */
export function executeInstanceReconciliation(instanceId, { transactions = [], deposits = [] } = {}) {
  const instance = customerInstances.get(instanceId);
  if (!instance) throw new Error(`Customer instance '${instanceId}' not found`);

  if (instance.status !== 'ACTIVE') {
    throw new Error(`Instance must be ACTIVE to execute reconciliation (currently ${instance.status})`);
  }

  const report = reconcileFiverrPayoutBatch({ transactions, deposits });
  const feeRecoveryCents = report.summary.platformFeesCents;

  instance.metrics.totalBatchesRun += 1;
  instance.metrics.totalVerifiedFeeRecoveryCents += feeRecoveryCents;
  instance.metrics.lastEvidenceRef = report.evidenceRef;

  const entry = {
    runId: `run_${Date.now()}`,
    executedAt: report.reconciledAt,
    balanced: report.balanced,
    verifiedFeeRecoveryCents: feeRecoveryCents,
    evidenceRef: report.evidenceRef,
    summary: report.summary,
    discrepancies: report.discrepancies
  };

  instance.history.unshift(entry);
  return {
    report,
    instance
  };
}

/**
 * Retrieves a customer instance by ID.
 */
export function getCustomerInstance(instanceId) {
  return customerInstances.get(instanceId) || null;
}

/**
 * Lists all customer instances.
 */
export function listCustomerInstances() {
  return Array.from(customerInstances.values());
}

/**
 * Resets instances state (for test isolation).
 */
export function _resetCustomerInstancesState() {
  customerInstances.clear();
}
