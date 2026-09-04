import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NAMED_ACTIONS,
  ACTION_POLICY,
  ACTION_OUTBOX_STATUS,
  recordActionIntent,
  approveActionIntent,
  dispatchOutboxAction,
  reconcileOutboxSettlement,
  _resetActionOutboxState
} from '../src/action-registry.js';

test.beforeEach(() => {
  _resetActionOutboxState();
});

test('named actions fail closed on unknown action ID', () => {
  assert.throws(() => {
    recordActionIntent({
      actionId: 'unknown_speculative_action',
      idempotencyKey: 'idem_1'
    });
  }, /Unknown actionId 'unknown_speculative_action'/);
});

test('idempotent action recording avoids duplicating write intent', () => {
  const first = recordActionIntent({
    actionId: NAMED_ACTIONS.FIVERR_STATEMENT_RECONCILE.id,
    idempotencyKey: 'fiverr_batch_001',
    payload: { batchId: 'b1' }
  });

  assert.equal(first.idempotentReplay, false);
  assert.equal(first.outboxRecord.status, ACTION_OUTBOX_STATUS.INTENT_RECORDED);

  const second = recordActionIntent({
    actionId: NAMED_ACTIONS.FIVERR_STATEMENT_RECONCILE.id,
    idempotencyKey: 'fiverr_batch_001',
    payload: { batchId: 'b1' }
  });

  assert.equal(second.idempotentReplay, true);
  assert.equal(second.outboxRecord.id, first.outboxRecord.id);
});

test('high-risk actions require expiring approval before dispatch', async () => {
  const { outboxRecord } = recordActionIntent({
    actionId: NAMED_ACTIONS.SEND_CUSTOMER_INVOICE.id,
    idempotencyKey: 'inv_outbox_999',
    payload: { amountCents: 1900 }
  });

  assert.equal(outboxRecord.status, ACTION_OUTBOX_STATUS.PENDING_APPROVAL);
  assert.ok(outboxRecord.approvalId);

  // Attempting to dispatch before approval throws
  await assert.rejects(async () => {
    await dispatchOutboxAction(outboxRecord.id, {
      externalSenderFn: async () => ({ invoiceId: 'in_123' })
    });
  }, /requires valid human approval before dispatch/);

  // Approve action
  approveActionIntent({ approvalId: outboxRecord.approvalId, approvedBy: 'finance_lead' });

  // Dispatch succeeds
  const dispatched = await dispatchOutboxAction(outboxRecord.id, {
    externalSenderFn: async () => ({ invoiceId: 'in_123', status: 'sent' })
  });

  assert.equal(dispatched.status, ACTION_OUTBOX_STATUS.DISPATCHED);
  assert.equal(dispatched.dispatchReceipt.invoiceId, 'in_123');
});

test('crash after lease transitions to RECONCILE_REQUIRED rather than blind retry', async () => {
  const { outboxRecord } = recordActionIntent({
    actionId: NAMED_ACTIONS.FIVERR_STATEMENT_RECONCILE.id,
    idempotencyKey: 'recon_crash_001'
  });

  const failed = await dispatchOutboxAction(outboxRecord.id, {
    externalSenderFn: async () => {
      throw new Error('Network socket closed abruptly');
    }
  });

  assert.equal(failed.status, ACTION_OUTBOX_STATUS.RECONCILE_REQUIRED);
  assert.ok(failed.dispatchReceipt.error.includes('Network socket closed'));

  // Settlement reconciliation recovers it
  const cleared = reconcileOutboxSettlement({
    outboxId: failed.id,
    externalRef: 'stripe_ch_999',
    status: 'CLEARED',
    netCents: 1900
  });

  assert.equal(cleared.status, ACTION_OUTBOX_STATUS.CLEARED);
  assert.equal(cleared.clearedAmountCents, 1900);
});
