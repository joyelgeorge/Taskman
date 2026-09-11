import { createHash } from 'node:crypto';

const webhookLedger = new Map();
const DEFAULT_MUTEX_TTL_MS = 60 * 1000; // 60s mutex lock

export function createStripeWebhookMutex({ ttlMs = DEFAULT_MUTEX_TTL_MS } = {}) {
  return {
    async processWebhook({ eventId, eventType, payload, handler }) {
      if (!eventId || typeof eventId !== 'string') {
        throw new Error('Stripe webhook event requires a valid eventId string');
      }

      const hash = createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
      const key = `stripe:${eventType}:${eventId}`;
      const now = Date.now();

      // Check existing lock / completed result
      const existing = webhookLedger.get(key);
      if (existing) {
        if (existing.status === 'COMPLETED') {
          return {
            idempotentReplay: true,
            status: 'replayed',
            result: existing.result,
            durationMs: 0
          };
        }
        if (existing.status === 'PROCESSING' && now - existing.startedAt < ttlMs) {
          return {
            idempotentReplay: true,
            status: 'in_flight_locked',
            message: 'Webhook is currently being processed by another worker',
            durationMs: 0
          };
        }
      }

      // Acquire lock atomically
      webhookLedger.set(key, {
        status: 'PROCESSING',
        hash,
        startedAt: now
      });

      try {
        const t0 = Date.now();
        const result = await handler(payload);
        const durationMs = Date.now() - t0;

        webhookLedger.set(key, {
          status: 'COMPLETED',
          hash,
          completedAt: Date.now(),
          result
        });

        return {
          idempotentReplay: false,
          status: 'executed',
          result,
          durationMs
        };
      } catch (err) {
        // Release lock on fatal failure to permit legitimate retry
        webhookLedger.delete(key);
        throw err;
      }
    },

    clearMemory() {
      webhookLedger.clear();
    }
  };
}
