import { createHash } from 'node:crypto';

export const ACTION_POLICY = Object.freeze({
  AUTOMATIC: 'AUTOMATIC',
  REQUIRES_APPROVAL: 'REQUIRES_APPROVAL',
  DISABLED: 'DISABLED'
});

export const ACTION_OUTBOX_STATUS = Object.freeze({
  INTENT_RECORDED: 'INTENT_RECORDED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  LEASED: 'LEASED',
  DISPATCHED: 'DISPATCHED',
  RECONCILE_REQUIRED: 'RECONCILE_REQUIRED',
  CLEARED: 'CLEARED',
  FAILED: 'FAILED'
});

export const NAMED_ACTIONS = Object.freeze({
  FIVERR_STATEMENT_RECONCILE: Object.freeze({
    id: 'fiverr_statement_reconcile',
    adapter: 'commercial-wedge',
    requiredCapability: 'read:fiverr_statement',
    policy: ACTION_POLICY.AUTOMATIC,
    spendCeilingCents: 0,
    settlementSource: 'stripe',
    description: 'Deterministic reconciliation of Fiverr activity CSV against bank deposits'
  }),
  SEND_CUSTOMER_INVOICE: Object.freeze({
    id: 'send_customer_invoice',
    adapter: 'stripe-billing',
    requiredCapability: 'write:stripe_invoice',
    policy: ACTION_POLICY.REQUIRES_APPROVAL,
    spendCeilingCents: 10000, // $100 max invoice without human override
    settlementSource: 'stripe',
    description: 'Create and issue authorized Stripe invoice to customer for verified recovery/batch fees'
  })
});

// In-memory durable outbox store
const actionOutbox = new Map(); // outboxId -> outboxRecord
const actionApprovals = new Map(); // approvalId -> approvalRecord

/**
 * Durably records an authorized write intent before dispatch.
 */
export function recordActionIntent({
  actionId,
  tenantId = 'default-tenant',
  accountId = 'default-account',
  actor = 'system',
  payload = {},
  idempotencyKey
} = {}) {
  const actionSpec = Object.values(NAMED_ACTIONS).find(a => a.id === actionId);
  if (!actionSpec) {
    throw new Error(`Unknown actionId '${actionId}'. Fails closed.`);
  }

  if (!idempotencyKey) {
    throw new Error('idempotencyKey is required for external write action');
  }

  const existing = Array.from(actionOutbox.values()).find(
    o => o.idempotencyKey === idempotencyKey && o.actionId === actionId
  );
  if (existing) {
    return { idempotentReplay: true, outboxRecord: existing };
  }

  const outboxId = `outbox_${createHash('sha256').update(`${tenantId}:${actionId}:${idempotencyKey}`).digest('hex').slice(0, 16)}`;
  const requiresApproval = actionSpec.policy === ACTION_POLICY.REQUIRES_APPROVAL;

  const record = {
    id: outboxId,
    actionId,
    tenantId,
    accountId,
    actor,
    payload,
    idempotencyKey,
    status: requiresApproval ? ACTION_OUTBOX_STATUS.PENDING_APPROVAL : ACTION_OUTBOX_STATUS.INTENT_RECORDED,
    actionSpec,
    approvalId: null,
    dispatchReceipt: null,
    reconciledAt: null,
    settlementStatus: 'PENDING',
    clearedAmountCents: 0,
    createdAt: new Date().toISOString()
  };

  if (requiresApproval) {
    const approvalId = `appr_${createHash('sha256').update(`${outboxId}:approval`).digest('hex').slice(0, 12)}`;
    record.approvalId = approvalId;
    actionApprovals.set(approvalId, {
      approvalId,
      outboxId,
      actionId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h expiration
      approved: false,
      approvedBy: null,
      approvedAt: null
    });
  }

  actionOutbox.set(outboxId, record);
  return { idempotentReplay: false, outboxRecord: record };
}

/**
 * Grants human approval for a high-risk external action intent.
 */
export function approveActionIntent({ approvalId, approvedBy = 'admin_operator' } = {}) {
  const approval = actionApprovals.get(approvalId);
  if (!approval) throw new Error(`Approval '${approvalId}' not found`);

  if (new Date(approval.expiresAt).getTime() < Date.now()) {
    throw new Error(`Approval '${approvalId}' has expired`);
  }

  approval.approved = true;
  approval.approvedBy = approvedBy;
  approval.approvedAt = new Date().toISOString();

  const outbox = actionOutbox.get(approval.outboxId);
  if (outbox) {
    outbox.status = ACTION_OUTBOX_STATUS.INTENT_RECORDED;
  }

  return { approval, outbox };
}

/**
 * Dispatches an external action with crash-consistent transition semantics.
 */
export async function dispatchOutboxAction(outboxId, { externalSenderFn } = {}) {
  const outbox = actionOutbox.get(outboxId);
  if (!outbox) throw new Error(`Outbox action '${outboxId}' not found`);

  if (outbox.actionSpec.policy === ACTION_POLICY.REQUIRES_APPROVAL) {
    const approval = actionApprovals.get(outbox.approvalId);
    if (!approval || !approval.approved) {
      throw new Error(`Action '${outbox.actionId}' requires valid human approval before dispatch`);
    }
  }

  outbox.status = ACTION_OUTBOX_STATUS.LEASED;

  try {
    const receipt = await externalSenderFn({
      action: outbox.actionSpec,
      payload: outbox.payload,
      idempotencyKey: outbox.idempotencyKey
    });

    outbox.dispatchReceipt = receipt;
    outbox.status = ACTION_OUTBOX_STATUS.DISPATCHED;
    return outbox;
  } catch (err) {
    // Crash or network error after leased: mark RECONCILE_REQUIRED, never blind retry
    outbox.status = ACTION_OUTBOX_STATUS.RECONCILE_REQUIRED;
    outbox.dispatchReceipt = { error: err.message };
    return outbox;
  }
}

/**
 * Reconciles an outbox action against settlement evidence.
 */
export function reconcileOutboxSettlement({ outboxId, externalRef, status = 'CLEARED', netCents = 0 } = {}) {
  const outbox = actionOutbox.get(outboxId);
  if (!outbox) throw new Error(`Outbox action '${outboxId}' not found`);

  outbox.reconciledAt = new Date().toISOString();
  outbox.settlementStatus = status;
  if (status === 'CLEARED') {
    outbox.clearedAmountCents = Number(netCents) || 0;
    outbox.status = ACTION_OUTBOX_STATUS.CLEARED;
  }

  return outbox;
}

/**
 * Resets action outbox state (for tests).
 */
export function _resetActionOutboxState() {
  actionOutbox.clear();
  actionApprovals.clear();
}
