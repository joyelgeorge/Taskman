import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { databaseEnabled, query } from './db.js';

export const WEBHOOK_MAX_BYTES = 256 * 1024;
export const WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

const memoryReceipts = new Map();

export class WebhookIngressError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'WebhookIngressError';
    this.code = code;
    this.status = status;
  }
}

function headerValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizedSecrets(secrets) {
  return (Array.isArray(secrets) ? secrets : [secrets])
    .map(value => String(value || ''))
    .filter(Boolean);
}

export async function readRawWebhookBody(req, maxBytes = WEBHOOK_MAX_BYTES) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new WebhookIngressError('WEBHOOK_BODY_TOO_LARGE', 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function verifyWebhookRequest({
  rawBody,
  signature,
  timestamp,
  deliveryId,
  secrets,
  now = Date.now(),
  maxAgeSeconds = WEBHOOK_MAX_AGE_SECONDS
}) {
  const secretList = normalizedSecrets(secrets);
  if (secretList.length === 0) throw new WebhookIngressError('WEBHOOK_DISABLED', 503);

  const id = String(headerValue(deliveryId) || '').trim();
  if (!id || id.length > 200) throw new WebhookIngressError('WEBHOOK_DELIVERY_ID_REQUIRED');

  const timestampText = String(headerValue(timestamp) || '').trim();
  if (!/^\d{10}$/.test(timestampText)) throw new WebhookIngressError('WEBHOOK_TIMESTAMP_INVALID');
  const timestampMs = Number(timestampText) * 1000;
  if (Math.abs(now - timestampMs) > maxAgeSeconds * 1000) {
    throw new WebhookIngressError(timestampMs > now ? 'WEBHOOK_TIMESTAMP_FUTURE' : 'WEBHOOK_TIMESTAMP_STALE');
  }

  const match = /^sha256=([a-f0-9]{64})$/i.exec(String(headerValue(signature) || '').trim());
  if (!match) throw new WebhookIngressError('WEBHOOK_SIGNATURE_INVALID', 401);

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '');
  const signed = Buffer.concat([Buffer.from(timestampText + '.'), body]);
  const supplied = Buffer.from(match[1], 'hex');
  let valid = false;
  for (const secret of secretList) {
    const expected = createHmac('sha256', secret).update(signed).digest();
    valid = timingSafeEqual(expected, supplied) || valid;
  }
  if (!valid) throw new WebhookIngressError('WEBHOOK_SIGNATURE_INVALID', 401);

  return {
    deliveryId: id,
    bodyHash: createHash('sha256').update(body).digest('hex'),
    verifiedAt: new Date(now).toISOString(),
    verificationMethod: 'hmac-sha256-shared-secret',
    authoritative: false
  };
}

export async function recordWebhookReceipt({
  provider,
  deliveryId,
  eventType,
  bodyHash,
  verificationMethod,
  now = new Date()
}) {
  const key = `${provider}:${deliveryId}`;
  if (!databaseEnabled) {
    const existing = memoryReceipts.get(key);
    if (existing) {
      if (existing.bodyHash !== bodyHash) {
        throw new WebhookIngressError('WEBHOOK_DELIVERY_CONFLICT', 409);
      }
      return { ...existing, duplicate: true };
    }
    const receipt = {
      provider,
      deliveryId,
      eventType,
      bodyHash,
      verificationMethod,
      processingState: 'RECEIVED',
      attemptCount: 0,
      receivedAt: new Date(now).toISOString()
    };
    memoryReceipts.set(key, receipt);
    return { ...receipt, duplicate: false };
  }

  const inserted = await query(`
    INSERT INTO webhook_receipts(
      provider, delivery_id, event_type, body_hash, verification_method, processing_state, received_at
    ) VALUES($1,$2,$3,$4,$5,'RECEIVED',$6)
    ON CONFLICT(provider, delivery_id) DO NOTHING
    RETURNING *
  `, [provider, deliveryId, eventType, bodyHash, verificationMethod, now]);
  if (inserted.rows[0]) return { ...inserted.rows[0], duplicate: false };

  const current = await query(
    'SELECT * FROM webhook_receipts WHERE provider=$1 AND delivery_id=$2',
    [provider, deliveryId]
  );
  if (!current.rows[0] || current.rows[0].body_hash !== bodyHash) {
    throw new WebhookIngressError('WEBHOOK_DELIVERY_CONFLICT', 409);
  }
  return { ...current.rows[0], duplicate: true };
}

export function resetWebhookReceiptsForTesting() {
  memoryReceipts.clear();
}
