#!/usr/bin/env node
/**
 * End-to-end self-test script for the self-serve scanner core and paywall.
 * Exercises POST /scan -> GET /report (locked) -> POST /checkout -> GET /report (unlocked).
 */
import { createScanApp } from '../packages/web/scan-server/app.js';

console.log('Testing Self-Serve Scanner Pipeline...\n');

const mockFindings = [
  { kind: 'exposed-secret', file: 'https://demo-vibe-app.com/bundle.js' },
  { kind: 'missing-rls', evidence: 'table: customer_profiles' }
];

const mockScanImpl = async (url) => ({
  app: url,
  reachable: true,
  findings: mockFindings
});

const paidTokens = new Set();

const app = createScanApp({
  scanImpl: mockScanImpl,
  verifyPayment: async (scanId, token) => paidTokens.has(token),
  createOrder: async (scanId) => ({
    orderId: 'ORDER-' + scanId,
    approveUrl: `https://www.paypal.com/checkoutnow?token=ORDER-${scanId}`
  })
});

// 1. Health check
const health = await app.handle('GET', '/health', null);
if (health.status !== 200 || !health.body.ok) {
  console.error('FAIL: /health check failed', health);
  process.exit(1);
}
console.log('✓ GET /health: 200 OK');

// 2. Scan request
const scan = await app.handle('POST', '/scan', { url: 'https://demo-vibe-app.com' });
if (scan.status !== 200 || !scan.body.scanId || !scan.body.locked) {
  console.error('FAIL: POST /scan failed', scan);
  process.exit(1);
}
const scanId = scan.body.scanId;
console.log(`✓ POST /scan: issued scanId ${scanId}, locked: true, total: ${scan.body.total}`);

// 3. Unauthorized report fetch (paywall fails closed)
const lockedReport = await app.handle('GET', `/report?id=${scanId}`, null);
if (lockedReport.status !== 402 || lockedReport.body.error !== 'payment required' || lockedReport.body.fixes) {
  console.error('FAIL: GET /report failed closed check', lockedReport);
  process.exit(1);
}
console.log('✓ GET /report without payment: 402 Payment Required (paywall fails closed)');

// 4. Checkout initiation
const checkout = await app.handle('POST', '/checkout', { scanId });
if (checkout.status !== 200 || !checkout.body.approveUrl || !checkout.body.orderId) {
  console.error('FAIL: POST /checkout failed', checkout);
  process.exit(1);
}
console.log(`✓ POST /checkout: created order ${checkout.body.orderId} -> ${checkout.body.approveUrl}`);

// 5. Payment completed -> unlocked report fetch
const token = checkout.body.orderId;
paidTokens.add(token);

const unlockedReport = await app.handle('GET', `/report?id=${scanId}&t=${token}`, null);
if (unlockedReport.status !== 200 || unlockedReport.body.locked || !unlockedReport.body.fixes) {
  console.error('FAIL: GET /report unlocked fetch failed', unlockedReport);
  process.exit(1);
}
console.log(`✓ GET /report with verified payment: 200 OK, unlocked ${unlockedReport.body.fixes.length} fixes`);

console.log('\nAll Self-Serve Scanner verification checks PASSED successfully!');
process.exit(0);
