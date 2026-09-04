import crypto from 'node:crypto';
import { databaseEnabled, query } from './db.js';

// In-memory registry for payout leakage rails and evaluations
const leakageRailsRegistry = new Map();
const leakageIncidentsMemory = new Map(); // id -> incident

export const LEAKAGE_DISCREPANCY_TYPE = Object.freeze({
  UNEXPLAINED_FEE_VARIANCE: 'UNEXPLAINED_FEE_VARIANCE',
  DUPLICATE_OR_FAILED_PAYOUT: 'DUPLICATE_OR_FAILED_PAYOUT',
  FX_CONVERSION_VARIANCE: 'FX_CONVERSION_VARIANCE',
  SETTLEMENT_TIMING_MISMATCH: 'SETTLEMENT_TIMING_MISMATCH',
  REFUND_REVERSAL_MISMATCH: 'REFUND_REVERSAL_MISMATCH',
  UNCLAIMED_STRANDED_BALANCE: 'UNCLAIMED_STRANDED_BALANCE',
  INCORRECT_WITHHOLDING: 'INCORRECT_WITHHOLDING'
});

export const LEAKAGE_LIFECYCLE_STAGE = Object.freeze({
  DETECTED: 'DETECTED',
  CUSTOMER_ACKNOWLEDGED: 'CUSTOMER_ACKNOWLEDGED',
  INTERVENTION_INITIATED: 'INTERVENTION_INITIATED',
  INTERVENTION_ACCEPTED: 'INTERVENTION_ACCEPTED',
  CASH_RECEIVED: 'CASH_RECEIVED',
  VERIFIED_NET_VALUE: 'VERIFIED_NET_VALUE',
  FEE_CHARGED: 'FEE_CHARGED',
  CASH_COLLECTED: 'CASH_COLLECTED'
});

/**
 * Declares and registers a generic payout-leakage rail.
 * Non-negotiable: Declares data source, settlement verification source, kill budget, and deterministic trigger.
 */
export function registerPayoutLeakageRail(spec) {
  if (!spec.railKey || !spec.source || !spec.settlementSource || !spec.deterministicTrigger || spec.killBudgetCents === undefined) {
    throw new Error('Rail requires railKey, source, settlementSource, deterministicTrigger, and killBudgetCents');
  }

  const rail = Object.freeze({
    railKey: spec.railKey,
    name: spec.name || spec.railKey,
    sourceFamily: spec.sourceFamily || 'general_marketplace',
    source: spec.source,
    settlementSource: spec.settlementSource, // e.g. 'stripe', 'bank', 'wise', 'paypal'
    deterministicTrigger: spec.deterministicTrigger,
    interventionMethod: spec.interventionMethod || 'statement_audit_and_dispute_pack',
    requiredCapabilities: Object.freeze([...(spec.requiredCapabilities || [])]),
    legalPolicyConstraints: Object.freeze([...(spec.legalPolicyConstraints || [])]),
    estimatedAcquisitionCostCents: spec.estimatedAcquisitionCostCents || 0,
    expectedExecutionCostCents: spec.expectedExecutionCostCents || 0,
    killBudgetCents: Number(spec.killBudgetCents),
    status: spec.status || 'probation',
    createdAt: new Date().toISOString()
  });

  leakageRailsRegistry.set(rail.railKey, rail);
  return rail;
}

export function getPayoutLeakageRail(railKey) {
  return leakageRailsRegistry.get(railKey) || null;
}

export function listPayoutLeakageRails({ activeOnly = false } = {}) {
  const all = Array.from(leakageRailsRegistry.values());
  if (activeOnly) return all.filter(r => r.status !== 'disabled');
  return all;
}

/**
 * Records a detected leakage incident.
 * Strictly maintains economic truth separation: detected amount != recovered cash.
 */
export function recordLeakageIncident({
  railKey,
  customerId,
  discrepancyType,
  detectedAmountCents,
  evidenceRefs = [],
  rawDiscrepancyPayload = {}
}) {
  const rail = getPayoutLeakageRail(railKey);
  if (!rail) {
    throw new Error(`Rail ${railKey} not registered`);
  }

  if (!Object.values(LEAKAGE_DISCREPANCY_TYPE).includes(discrepancyType)) {
    throw new Error(`Invalid discrepancyType: ${discrepancyType}`);
  }

  const id = `leak-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const incident = {
    id,
    railKey,
    customerId,
    discrepancyType,
    stage: LEAKAGE_LIFECYCLE_STAGE.DETECTED,
    // Economic truth levels:
    detectedAmountCents: Math.round(Number(detectedAmountCents || 0)),
    customerAcknowledgedAmountCents: 0,
    verifiedCashRecoveredCents: 0,
    feeChargedCents: 0,
    cashCollectedCents: 0,
    evidenceRefs: [...evidenceRefs],
    rawDiscrepancyPayload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  leakageIncidentsMemory.set(id, incident);
  return incident;
}

export function advanceLeakageIncidentStage(incidentId, nextStage, { amountCents = null, evidenceRef = null } = {}) {
  const incident = leakageIncidentsMemory.get(incidentId);
  if (!incident) {
    throw new Error(`Incident ${incidentId} not found`);
  }

  if (!Object.values(LEAKAGE_LIFECYCLE_STAGE).includes(nextStage)) {
    throw new Error(`Invalid stage: ${nextStage}`);
  }

  incident.stage = nextStage;
  incident.updatedAt = new Date().toISOString();

  if (evidenceRef) {
    incident.evidenceRefs.push(evidenceRef);
  }

  if (nextStage === LEAKAGE_LIFECYCLE_STAGE.CUSTOMER_ACKNOWLEDGED && amountCents !== null) {
    incident.customerAcknowledgedAmountCents = Math.round(Number(amountCents));
  } else if ((nextStage === LEAKAGE_LIFECYCLE_STAGE.CASH_RECEIVED || nextStage === LEAKAGE_LIFECYCLE_STAGE.VERIFIED_NET_VALUE) && amountCents !== null) {
    incident.verifiedCashRecoveredCents = Math.round(Number(amountCents));
  } else if (nextStage === LEAKAGE_LIFECYCLE_STAGE.FEE_CHARGED && amountCents !== null) {
    incident.feeChargedCents = Math.round(Number(amountCents));
  } else if (nextStage === LEAKAGE_LIFECYCLE_STAGE.CASH_COLLECTED && amountCents !== null) {
    incident.cashCollectedCents = Math.round(Number(amountCents));
  }

  return incident;
}

export function getLeakageIncident(id) {
  return leakageIncidentsMemory.get(id) || null;
}

export function resetPayoutLeakagePlatformMemory() {
  leakageRailsRegistry.clear();
  leakageIncidentsMemory.clear();
}
