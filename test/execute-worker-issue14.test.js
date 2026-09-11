import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isExecutionReadyRecord,
  EXECUTION_READY_CLASSIFICATIONS,
  resolveNamedAction,
  classifyExecutionError
} from '../src/workers/execute.js';
import {
  NAMED_ACTIONS,
  ACTION_POLICY,
  _resetActionOutboxState
} from '../src/action-registry.js';
import { resetMemoryIdempotencyLedger } from '../src/idempotency-ledger.js';

test.beforeEach(() => {
  _resetActionOutboxState();
  resetMemoryIdempotencyLedger();
});

test('#14 rejects non-execution-ready records before any adapter', () => {
  assert.equal(isExecutionReadyRecord({ payload: { classification: 'EXECUTABLE' } }), true);
  assert.equal(isExecutionReadyRecord({ payload: { classification: 'THRESHOLD_CROSSED' } }), true);
  assert.equal(isExecutionReadyRecord({ payload: { classification: 'SETUP_REQUIRED' } }), false);
  assert.equal(isExecutionReadyRecord({ payload: { classification: 'NEEDS_EVIDENCE' } }), false);
  assert.equal(isExecutionReadyRecord({ payload: { classification: 'REJECTED' } }), false);
  assert.equal(isExecutionReadyRecord({ payload: {} }), false);
  assert.equal(isExecutionReadyRecord(null), false);
  assert.ok(EXECUTION_READY_CLASSIFICATIONS.includes('EXECUTABLE'));
});

test('#14 resolveNamedAction maps commercial candidates to named actions', () => {
  const fiverr = resolveNamedAction({ sourceType: 'fiverr_statement', title: 'Reconcile Fiverr CSV' }, null);
  assert.equal(fiverr.id, NAMED_ACTIONS.FIVERR_STATEMENT_RECONCILE.id);
  assert.equal(fiverr.policy, ACTION_POLICY.AUTOMATIC);

  const invoicePlan = resolveNamedAction(
    { sourceType: 'other', title: 'x' },
    { steps: [{ adapter: 'stripe-billing', action: 'send_invoice' }] }
  );
  assert.equal(invoicePlan.id, NAMED_ACTIONS.SEND_CUSTOMER_INVOICE.id);
  assert.equal(invoicePlan.policy, ACTION_POLICY.REQUIRES_APPROVAL);

  assert.equal(resolveNamedAction({ sourceType: 'deskcrew', title: 'support bounty' }, null), null);
});

test('#14 classifyExecutionError distinguishes transient vs permanent failures', () => {
  assert.equal(classifyExecutionError({ code: 'ETIMEDOUT' }).transient, true);
  assert.equal(classifyExecutionError({ status: 429 }).transient, true);
  assert.equal(classifyExecutionError({ status: 503 }).transient, true);
  assert.equal(classifyExecutionError({ message: 'rate limit exceeded' }).transient, true);
  assert.equal(classifyExecutionError({ code: 'UNAUTHORIZED' }).transient, false);
  assert.equal(classifyExecutionError({ status: 400 }).transient, false);
  assert.equal(classifyExecutionError(new Error('schema invalid')).transient, false);
});

test('#14 unauthorized / unknown named action fails closed', () => {
  // resolveNamedAction returns null for unknown rails; execute path must BLOCKED
  assert.equal(resolveNamedAction({ sourceType: 'unknown-rail-xyz' }, null), null);
});
