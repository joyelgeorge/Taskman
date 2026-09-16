import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanApp } from '../packages/web/scan-server/app.js';

/**
 * The self-serve scanner's HTTP core. A stranger POSTs their URL, gets counts
 * (free); after paying they GET the full report with fixes. Tested without a
 * network by injecting the scan and the payment check.
 */

const fakeScan = async (url) => ({
  app: url, reachable: true,
  findings: [{ kind: 'exposed-secret', file: url + '/x.js' }, { kind: 'missing-rls', evidence: 'table: orders' }]
});

function app(over = {}) {
  return createScanApp({
    scanImpl: fakeScan,
    // payment check: a token is valid if it equals 'PAID-' + scanId (stand-in for a verified PayPal capture)
    verifyPayment: async (scanId, token) => token === 'PAID-' + scanId,
    ...over
  });
}

test('POST /scan returns counts and a scanId, but no fixes', async () => {
  const res = await app().handle('POST', '/scan', { url: 'https://demo.app' });
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);
  assert.ok(res.body.scanId, 'a scanId is issued so the report can be unlocked later');
  assert.equal(res.body.locked, true);
  assert.ok(!JSON.stringify(res.body).toLowerCase().includes('alter table'), 'no fixes in the free response');
});

test('POST /scan with no url is a 400, not a crash', async () => {
  const res = await app().handle('POST', '/scan', {});
  assert.equal(res.status, 400);
});

test('an unreachable site is reported, not a 500', async () => {
  const res = await app({ scanImpl: async () => ({ reachable: false, reason: 'ENOTFOUND' }) })
    .handle('POST', '/scan', { url: 'https://nope.invalid' });
  assert.equal(res.status, 200);
  assert.match(res.body.message, /reach|reHere/i);
});

test('GET /report without a valid payment token is refused', async () => {
  const a = app();
  const scan = await a.handle('POST', '/scan', { url: 'https://demo.app' });
  const res = await a.handle('GET', `/report?id=${scan.body.scanId}&t=wrong`, null);
  assert.equal(res.status, 402, 'payment required');
  assert.ok(!res.body.fixes, 'no fixes leak without payment');
});

test('GET /report WITH a valid payment token returns the fixes', async () => {
  const a = app();
  const scan = await a.handle('POST', '/scan', { url: 'https://demo.app' });
  const id = scan.body.scanId;
  const res = await a.handle('GET', `/report?id=${id}&t=PAID-${id}`, null);
  assert.equal(res.status, 200);
  assert.equal(res.body.locked, false);
  assert.equal(res.body.fixes.length, 2);
  assert.match(JSON.stringify(res.body), /rotate/i);
});

test('a report for an unknown scanId is a 404', async () => {
  const res = await app().handle('GET', '/report?id=nonexistent&t=x', null);
  assert.equal(res.status, 404);
});

test('/health is ok', async () => {
  const res = await app().handle('GET', '/health', null);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('an unknown route is a 404', async () => {
  const res = await app().handle('GET', '/whatever', null);
  assert.equal(res.status, 404);
});

test('POST /checkout creates a PayPal order for a known scan and returns the approve url', async () => {
  const a = createScanApp({
    scanImpl: fakeScan,
    verifyPayment: async () => false,
    createOrder: async (scanId, price) => ({ orderId: 'ORD-' + scanId, approveUrl: 'https://paypal.com/approve/ORD-' + scanId })
  });
  const scan = await a.handle('POST', '/scan', { url: 'https://demo.app' });
  const res = await a.handle('POST', '/checkout', { scanId: scan.body.scanId });
  assert.equal(res.status, 200);
  assert.match(res.body.approveUrl, /paypal\.com\/approve/);
  assert.ok(res.body.orderId);
});

test('POST /checkout for an unknown scan is a 404', async () => {
  const a = createScanApp({ scanImpl: fakeScan, verifyPayment: async () => false, createOrder: async () => ({}) });
  const res = await a.handle('POST', '/checkout', { scanId: 'nope' });
  assert.equal(res.status, 404);
});

test('POST /checkout with no createOrder configured is a clear 503, not a crash', async () => {
  const a = app(); // no createOrder injected
  const scan = await a.handle('POST', '/scan', { url: 'https://demo.app' });
  const res = await a.handle('POST', '/checkout', { scanId: scan.body.scanId });
  assert.equal(res.status, 503);
});
