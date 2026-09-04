import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerFirmAccount,
  getFirmAccount,
  createFirmCustomerInstance,
  getFirmCustomerInstance,
  listFirmCustomerInstances,
  executeFirmWorkflowReconciliation,
  confirmFirmCustomerOutcome,
  resetFirmWhiteLabelPlatformMemory
} from '../src/firm-whitelabel-platform.js';

test('registerFirmAccount and createFirmCustomerInstance enforce strict multi-tenant isolation', () => {
  resetFirmWhiteLabelPlatformMemory();

  const firmA = registerFirmAccount({
    firmId: 'apex_cpa',
    name: 'Apex CPA Group',
    brandConfig: { logoUrl: 'https://apex.example/logo.png', brandColor: '#123456' },
    commercialModel: 'hybrid',
    baseFeeMonthlyCents: 20000,
    outcomeFeePct: 20
  });

  const firmB = registerFirmAccount({
    firmId: 'summit_accounting',
    name: 'Summit Accounting LLC',
    outcomeFeePct: 15
  });

  assert.equal(firmA.firmId, 'apex_cpa');
  assert.equal(firmA.brandConfig.brandColor, '#123456');

  // Create instances under Firm A and Firm B
  const instA1 = createFirmCustomerInstance({
    firmId: 'apex_cpa',
    clientRef: 'client-101',
    clientName: 'Design Studio 1'
  });

  const instB1 = createFirmCustomerInstance({
    firmId: 'summit_accounting',
    clientRef: 'client-201',
    clientName: 'Engineering Co'
  });

  // Cross-tenant access is blocked
  assert.equal(getFirmCustomerInstance('apex_cpa', instA1.instanceId).clientName, 'Design Studio 1');
  assert.equal(getFirmCustomerInstance('summit_accounting', instA1.instanceId), null, 'Firm B cannot access Firm A client');
  assert.equal(listFirmCustomerInstances('apex_cpa').length, 1);
  assert.equal(listFirmCustomerInstances('summit_accounting').length, 1);
});

test('executeFirmWorkflowReconciliation and confirmFirmCustomerOutcome drive full API money lifecycle', () => {
  resetFirmWhiteLabelPlatformMemory();

  registerFirmAccount({
    firmId: 'kerala_cpa',
    name: 'Kerala Chartered Accountants',
    outcomeFeePct: 20
  });

  const inst = createFirmCustomerInstance({
    firmId: 'kerala_cpa',
    clientRef: 'client-k1',
    clientName: 'Freelancer Alpha'
  });

  // Execute reconciliation
  const runResult = executeFirmWorkflowReconciliation({
    firmId: 'kerala_cpa',
    instanceId: inst.instanceId,
    sourceData: [{ row: 1, amount: 500 }],
    reconciliationHandler: (rows) => ({ discrepancyCents: 10000, details: 'Found $100 payout variance' })
  });

  assert.equal(runResult.status, 'RECONCILED');
  assert.equal(runResult.economics.discrepancyIdentifiedCents, 10000);
  assert.equal(runResult.economics.verifiedCashRecoveredCents, 0, 'Discrepancy is not recovered cash yet');

  // Customer confirms outcome with bank proof of recovered cash
  const confirmed = confirmFirmCustomerOutcome({
    firmId: 'kerala_cpa',
    instanceId: inst.instanceId,
    confirmedRecoveredCashCents: 10000
  });

  assert.equal(confirmed.lifecycleStatus, 'OUTCOME_CONFIRMED');
  assert.equal(confirmed.economics.verifiedCashRecoveredCents, 10000);
  // 20% outcome fee on $100 recovered = $20 = 2000 cents
  assert.equal(confirmed.economics.invoiceableAmountCents, 2000);
  assert.equal(confirmed.auditLog.length, 3);
});
