import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createStripeWebhookMutex } from '../src/stripe-webhook-mutex.js';

describe('Stripe Webhook Idempotency Mutex', () => {
  let mutex;

  beforeEach(() => {
    mutex = createStripeWebhookMutex({ ttlMs: 5000 });
    mutex.clearMemory();
  });

  it('executes fresh webhook event successfully', async () => {
    let executions = 0;
    const res = await mutex.processWebhook({
      eventId: 'evt_test_101',
      eventType: 'invoice.payment_failed',
      payload: { invoiceId: 'in_123', customer: 'cus_456' },
      handler: async () => {
        executions++;
        return { scheduledRetry: true, attempt: 1 };
      }
    });

    assert.equal(res.idempotentReplay, false);
    assert.equal(res.status, 'executed');
    assert.equal(res.result.scheduledRetry, true);
    assert.equal(executions, 1);
  });

  it('blocks concurrent duplicate webhooks arriving simultaneously', async () => {
    let executions = 0;
    const concurrentDeliveries = 5;

    // Simulate 5 duplicate webhooks sent within the same millisecond
    const promises = Array.from({ length: concurrentDeliveries }).map((_, i) =>
      mutex.processWebhook({
        eventId: 'evt_test_race_202',
        eventType: 'invoice.payment_failed',
        payload: { invoiceId: 'in_race', attempt: i },
        handler: async () => {
          executions++;
          await new Promise(r => setTimeout(r, 50)); // simulate async billing worker
          return { scheduledRetry: true };
        }
      })
    );

    const results = await Promise.all(promises);

    const executed = results.filter(r => r.status === 'executed');
    const lockedOrReplayed = results.filter(r => r.status === 'in_flight_locked' || r.status === 'replayed');

    assert.equal(executed.length, 1, 'Only 1 worker should acquire the lock and execute');
    assert.equal(lockedOrReplayed.length, concurrentDeliveries - 1, 'All duplicates should be locked or replayed');
    assert.equal(executions, 1, 'Handler must only run exactly once');
  });

  it('returns cached completed result for subsequent delayed retries', async () => {
    let executions = 0;
    const handler = async () => {
      executions++;
      return { handled: true, timestamp: 12345 };
    };

    // First call
    const res1 = await mutex.processWebhook({
      eventId: 'evt_test_303',
      eventType: 'invoice.payment_failed',
      payload: { id: 1 },
      handler
    });
    assert.equal(res1.status, 'executed');

    // Duplicate call 100ms later
    const res2 = await mutex.processWebhook({
      eventId: 'evt_test_303',
      eventType: 'invoice.payment_failed',
      payload: { id: 1 },
      handler
    });
    assert.equal(res2.idempotentReplay, true);
    assert.equal(res2.status, 'replayed');
    assert.equal(res2.result.timestamp, 12345);
    assert.equal(executions, 1);
  });
});
