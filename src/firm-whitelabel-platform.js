import crypto from 'node:crypto';
import { databaseEnabled, query } from './db.js';

// In-memory stores for multi-tenant firm accounts, customer instances, and white-label configurations
const firmsMemoryStore = new Map(); // firmId -> firm
const firmInstancesMemoryStore = new Map(); // instanceId -> instance

/**
 * Registers an accounting firm or software partner.
 */
export function registerFirmAccount({
  firmId,
  name,
  brandConfig = {}, // { logoUrl, brandColor, customDomain, companyLegalName }
  commercialModel = 'hybrid', // 'per_client_monthly' | 'per_workflow_batch' | 'outcome_linked' | 'hybrid'
  baseFeeMonthlyCents = 10000,
  outcomeFeePct = 15
}) {
  if (!firmId || !name) {
    throw new Error('firmId and name are required');
  }

  const record = {
    firmId,
    name,
    brandConfig: {
      logoUrl: brandConfig.logoUrl || null,
      brandColor: brandConfig.brandColor || '#0052cc',
      customDomain: brandConfig.customDomain || null,
      companyLegalName: brandConfig.companyLegalName || name
    },
    commercialModel,
    pricing: {
      baseFeeMonthlyCents,
      outcomeFeePct
    },
    status: 'active',
    createdAt: new Date().toISOString()
  };

  firmsMemoryStore.set(firmId, record);
  return record;
}

export function getFirmAccount(firmId) {
  return firmsMemoryStore.get(firmId) || null;
}

/**
 * Creates an isolated customer instance under a firm.
 * Strict multi-tenant isolation: every instance is scoped to firmId.
 */
export function createFirmCustomerInstance({
  firmId,
  clientRef,
  clientName,
  templateVersion = '1.0.0',
  workflowConfig = {}
}) {
  const firm = getFirmAccount(firmId);
  if (!firm) {
    throw new Error(`Firm ${firmId} not registered`);
  }

  const instanceId = `inst-${firmId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const instance = {
    instanceId,
    firmId,
    clientRef: clientRef || instanceId,
    clientName,
    templateVersion,
    workflowConfig,
    lifecycleStatus: 'INITIALIZED',
    economics: {
      discrepancyIdentifiedCents: 0,
      customerConfirmedCents: 0,
      verifiedCashRecoveredCents: 0,
      invoiceableAmountCents: 0,
      cashCollectedCents: 0,
      executionCostCents: 0
    },
    auditLog: [
      {
        stage: 'INITIALIZED',
        timestamp: new Date().toISOString(),
        actor: 'firm_api'
      }
    ],
    createdAt: new Date().toISOString()
  };

  firmInstancesMemoryStore.set(instanceId, instance);
  return instance;
}

export function getFirmCustomerInstance(firmId, instanceId) {
  const inst = firmInstancesMemoryStore.get(instanceId);
  if (!inst || inst.firmId !== firmId) {
    return null; // Enforce tenant boundary
  }
  return inst;
}

export function listFirmCustomerInstances(firmId) {
  return Array.from(firmInstancesMemoryStore.values())
    .filter(i => i.firmId === firmId);
}

/**
 * Drives workflow execution via API: upload data, reconcile, and record economics.
 */
export function executeFirmWorkflowReconciliation({
  firmId,
  instanceId,
  sourceData = [],
  reconciliationHandler // fn(sourceData) => { discrepancyCents, details }
}) {
  const inst = getFirmCustomerInstance(firmId, instanceId);
  if (!inst) {
    throw new Error(`Instance ${instanceId} not found for firm ${firmId}`);
  }

  const outcome = reconciliationHandler(sourceData);
  inst.lifecycleStatus = 'RECONCILED';
  inst.economics.discrepancyIdentifiedCents = outcome.discrepancyCents || 0;
  inst.economics.executionCostCents += 25; // standard execution cost in cents

  inst.auditLog.push({
    stage: 'RECONCILED',
    discrepancyCents: inst.economics.discrepancyIdentifiedCents,
    timestamp: new Date().toISOString()
  });

  return {
    instanceId,
    status: inst.lifecycleStatus,
    economics: inst.economics,
    details: outcome.details
  };
}

/**
 * Confirms outcome and computes white-label firm billable fees.
 */
export function confirmFirmCustomerOutcome({
  firmId,
  instanceId,
  confirmedRecoveredCashCents
}) {
  const inst = getFirmCustomerInstance(firmId, instanceId);
  if (!inst) {
    throw new Error(`Instance ${instanceId} not found for firm ${firmId}`);
  }

  const firm = getFirmAccount(firmId);
  inst.lifecycleStatus = 'OUTCOME_CONFIRMED';
  inst.economics.verifiedCashRecoveredCents = Math.round(Number(confirmedRecoveredCashCents));
  
  // Calculate firm invoiceable amount using outcome fee percentage
  const feePct = firm.pricing.outcomeFeePct || 15;
  inst.economics.invoiceableAmountCents = Math.round((inst.economics.verifiedCashRecoveredCents * feePct) / 100);

  inst.auditLog.push({
    stage: 'OUTCOME_CONFIRMED',
    verifiedCashRecoveredCents: inst.economics.verifiedCashRecoveredCents,
    invoiceableAmountCents: inst.economics.invoiceableAmountCents,
    timestamp: new Date().toISOString()
  });

  return inst;
}

export function resetFirmWhiteLabelPlatformMemory() {
  firmsMemoryStore.clear();
  firmInstancesMemoryStore.clear();
}
