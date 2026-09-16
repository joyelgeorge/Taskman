#!/usr/bin/env node
/**
 * HTTP wrapper for the self-serve scanner. Deploy to a free Node host (Render,
 * like Jez). The static frontend on Firebase Hosting calls it.
 *
 * Env:
 *   PORT                  - injected by the host
 *   PAYPAL_CLIENT_ID      - to verify a completed order (server-side)
 *   PAYPAL_SECRET         - "
 *   PAYPAL_ENV            - 'live' (default) or 'sandbox'
 *   REPORT_PRICE_USD      - the unlock price (default 5)
 *   ALLOW_ORIGIN          - CORS origin for the frontend (default *)
 */
import { createServer } from 'node:http';
import { createScanApp } from './app.js';
import { scanDeployedApp } from '../../core/jobs/bundle-scan.js';
import { verifyPayPalOrder } from './paypal.js';

const PRICE = process.env.REPORT_PRICE_USD || '5';
const ORIGIN = process.env.ALLOW_ORIGIN || '*';

const app = createScanApp({
  scanImpl: (url) => scanDeployedApp(url),
  // The token is a PayPal order id the frontend captured. Verify it server-side
  // against PayPal: it must be COMPLETED and paid to us for at least the price.
  verifyPayment: (scanId, token) => verifyPayPalOrder(token, { minUsd: Number(PRICE) })
});

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad json' }); } }
    try {
      const r = await app.handle(req.method, req.url, body);
      send(res, r.status, { ...r.body, priceUsd: PRICE });
    } catch (e) {
      send(res, 500, { error: 'scan failed', detail: String(e.message).slice(0, 120) });
    }
  });
}).listen(Number(process.env.PORT || 8080), () => console.log(`scan-server on :${process.env.PORT || 8080}`));
