import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REUSABLE_CUSTOMER_TEMPLATE_SPEC,
  instantiateCustomerTemplate,
  verifyInstanceReadiness,
  setInstanceIntegration,
  setInstanceActive,
  executeInstanceReconciliation,
  getCustomerInstance,
  listCustomerInstances,
  _resetCustomerInstancesState
} from '../src/customer-template.js';

test.beforeEach(() => {
  _resetCustomerInstancesState();
});

test('REUSABLE_CUSTOMER_TEMPLATE_SPEC captures versioned template and manual work mitigation', () => {
  assert.equal(REUSABLE_CUSTOMER_TEMPLATE_SPEC.templateId, 'fiverr_agency_reconciliation_template_v1');
  assert.equal(REUSABLE_CUSTOMER_TEMPLATE_SPEC.version, 1);
  assert.ok(REUSABLE_CUSTOMER_TEMPLATE_SPEC.requiredIntegrations.includes('fiverrStatements'));
  assert.ok(REUSABLE_CUSTOMER_TEMPLATE_SPEC.requiredIntegrations.includes('bankDeposits'));
  assert.ok(REUSABLE_CUSTOMER_TEMPLATE_SPEC.manualWorkPoints.length >= 2);
});

test('instantiateCustomerTemplate creates isolated configuration for multiple independent instances', () => {
  const instance1 = instantiateCustomerTemplate({
    instanceId: 'inst-agency-1',
    tenantId: 'tenant-1',
    agencyName: 'Studio Alpha',
    fiverrUsername: 'alpha_pro'
  });

  const instance2 = instantiateCustomerTemplate({
    instanceId: 'inst-agency-2',
    tenantId: 'tenant-2',
    agencyName: 'Studio Beta',
    fiverrUsername: 'beta_pro'
  });

  assert.equal(instance1.agencyName, 'Studio Alpha');
  assert.equal(instance2.agencyName, 'Studio Beta');
  assert.equal(listCustomerInstances().length, 2);
});

test('verifyInstanceReadiness detects missing integrations and gates activation', () => {
  instantiateCustomerTemplate({
    instanceId: 'inst-agency-1',
    tenantId: 'tenant-1',
    agencyName: 'Studio Alpha',
    fiverrUsername: 'alpha_pro'
  });

  const readiness1 = verifyInstanceReadiness('inst-agency-1');
  assert.equal(readiness1.ready, false);
  assert.ok(readiness1.blockers.length >= 2);

  assert.throws(() => {
    setInstanceActive('inst-agency-1', true);
  }, /Cannot activate instance with blockers/);

  // Connect required integrations
  setInstanceIntegration('inst-agency-1', 'fiverrStatements', true);
  setInstanceIntegration('inst-agency-1', 'bankDeposits', true);

  const readiness2 = verifyInstanceReadiness('inst-agency-1');
  assert.equal(readiness2.ready, true);

  const activated = setInstanceActive('inst-agency-1', true);
  assert.equal(activated.status, 'ACTIVE');
});

test('executeInstanceReconciliation isolates evidence and history between tenants', () => {
  instantiateCustomerTemplate({
    instanceId: 'inst-1',
    tenantId: 't-1',
    agencyName: 'Studio 1',
    fiverrUsername: 'user1'
  });
  setInstanceIntegration('inst-1', 'fiverrStatements', true);
  setInstanceIntegration('inst-1', 'bankDeposits', true);
  setInstanceActive('inst-1', true);

  instantiateCustomerTemplate({
    instanceId: 'inst-2',
    tenantId: 't-2',
    agencyName: 'Studio 2',
    fiverrUsername: 'user2'
  });
  setInstanceIntegration('inst-2', 'fiverrStatements', true);
  setInstanceIntegration('inst-2', 'bankDeposits', true);
  setInstanceActive('inst-2', true);

  // Execute on instance 1
  executeInstanceReconciliation('inst-1', {
    transactions: [{ grossAmount: 500, platformFee: 100 }],
    deposits: [{ amount: 400 }]
  });

  const i1 = getCustomerInstance('inst-1');
  const i2 = getCustomerInstance('inst-2');

  assert.equal(i1.metrics.totalBatchesRun, 1);
  assert.equal(i1.metrics.totalReconciledFeesCents, 10000);
  assert.equal(i1.history.length, 1);

  // Instance 2 remains untouched
  assert.equal(i2.metrics.totalBatchesRun, 0);
  assert.equal(i2.metrics.totalReconciledFeesCents, 0);
  assert.equal(i2.history.length, 0);
});
