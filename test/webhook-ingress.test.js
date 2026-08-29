import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  verifyWebhookRequest,
  recordWebhookReceipt,
  resetWebhookReceiptsForTesting
} from '../src/webhook-ingress.js';

const secret = 'test-secret-with-at-least-thirty-two-bytes';
const timestamp = '1788030000';
const now = Number(timestamp) * 1000;
const rawBody = Buffer.from('{"event":"message.created","data":{"id":"msg_1"}}');

function signature(body = rawBody, key = secret, at = timestamp) {
  return 'sha256=' + createHmac('sha256', key)
    .update(Buffer.concat([Buffer.from(at + '.'), body]))
    .digest('hex');
}

test.beforeEach(() => resetWebhookReceiptsForTesting());

test('verifies an exact raw-body HMAC and returns only receipt metadata', () => {
  const result = verifyWebhookRequest({
    rawBody,
    signature: signature(),
    timestamp,
    deliveryId: 'delivery-1',
    secrets: [secret],
    now
  });
  assert.equal(result.deliveryId, 'delivery-1');
  assert.equal(result.bodyHash.length, 64);
  assert.equal(result.authoritative, false);
  assert.equal(result.rawBody, undefined);
});

test('rejects unsigned, tampered, stale, and future deliveries', () => {
  const base = { rawBody, timestamp, deliveryId: 'delivery-1', secrets: [secret], now };
  assert.throws(() => verifyWebhookRequest({ ...base, signature: '' }), /WEBHOOK_SIGNATURE_INVALID/);
  assert.throws(() => verifyWebhookRequest({
    ...base, rawBody: Buffer.from('tampered'), signature: signature()
  }), /WEBHOOK_SIGNATURE_INVALID/);
  assert.throws(() => verifyWebhookRequest({
    ...base, signature: signature(), timestamp: String(Number(timestamp) - 301)
  }), /WEBHOOK_TIMESTAMP_STALE/);
  const future = String(Number(timestamp) + 301);
  assert.throws(() => verifyWebhookRequest({
    ...base, signature: signature(rawBody, secret, future), timestamp: future
  }), /WEBHOOK_TIMESTAMP_FUTURE/);
});

test('supports a previous secret during rotation', () => {
  assert.doesNotThrow(() => verifyWebhookRequest({
    rawBody,
    signature: signature(rawBody, 'previous-secret-with-thirty-two-bytes'),
    timestamp,
    deliveryId: 'delivery-rotation',
    secrets: [secret, 'previous-secret-with-thirty-two-bytes'],
    now
  }));
});

test('fails closed when no ingress secret is configured', () => {
  assert.throws(() => verifyWebhookRequest({
    rawBody, signature: signature(), timestamp, deliveryId: 'delivery-1', secrets: [], now
  }), /WEBHOOK_DISABLED/);
});

test('deduplicates identical deliveries and rejects same-id different-body conflicts', async () => {
  const first = await recordWebhookReceipt({
    provider: 'moltjobs',
    deliveryId: 'delivery-1',
    eventType: 'message.created',
    bodyHash: 'a'.repeat(64),
    verificationMethod: 'hmac-sha256-shared-secret',
    now: new Date(now)
  });
  const duplicate = await recordWebhookReceipt({
    provider: 'moltjobs',
    deliveryId: 'delivery-1',
    eventType: 'message.created',
    bodyHash: 'a'.repeat(64),
    verificationMethod: 'hmac-sha256-shared-secret',
    now: new Date(now)
  });
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  await assert.rejects(() => recordWebhookReceipt({
    provider: 'moltjobs',
    deliveryId: 'delivery-1',
    eventType: 'message.created',
    bodyHash: 'b'.repeat(64),
    verificationMethod: 'hmac-sha256-shared-secret',
    now: new Date(now)
  }), /WEBHOOK_DELIVERY_CONFLICT/);
});
