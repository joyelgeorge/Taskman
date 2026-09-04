import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINIMUM_STACK_CONFIG,
  verifyCustomerStackReady
} from '../src/integration-stack.js';

test('MINIMUM_STACK_CONFIG freezes exactly four active components and lists deferred rails', () => {
  assert.equal(MINIMUM_STACK_CONFIG.wedgeId, 'fiverr_bookkeeping_reconciliation_v1');
  assert.equal(MINIMUM_STACK_CONFIG.stack.trigger.platform, 'Fiverr');
  assert.equal(MINIMUM_STACK_CONFIG.stack.execution.adapter, 'commercial-wedge');
  assert.equal(MINIMUM_STACK_CONFIG.stack.outcomeEvidence.type, 'hashed_audit_report');
  assert.equal(MINIMUM_STACK_CONFIG.stack.billing.processor, 'stripe');

  assert.ok(MINIMUM_STACK_CONFIG.deferredRails.includes('x402_crypto_payments'));
  assert.ok(MINIMUM_STACK_CONFIG.deferredRails.includes('deskcrew_bounties'));
  assert.ok(MINIMUM_STACK_CONFIG.deferredRails.includes('moltjobs_crawler'));
  assert.ok(MINIMUM_STACK_CONFIG.deferredRails.length >= 6);
});

test('verifyCustomerStackReady passes in test/dev environment', () => {
  const result = verifyCustomerStackReady({ env: { NODE_ENV: 'test' } });
  assert.equal(result.ready, true);
  assert.equal(result.status, 'READY');
  assert.equal(result.missing.length, 0);
});

test('verifyCustomerStackReady flags missing Stripe key in production', () => {
  const result = verifyCustomerStackReady({ env: { NODE_ENV: 'production' } });
  assert.equal(result.ready, false);
  assert.equal(result.status, 'SETUP_REQUIRED');
  assert.ok(result.missing.includes('STRIPE_API_KEY'));
});
