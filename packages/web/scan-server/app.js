/**
 * The self-serve scanner's HTTP core, as a testable handler.
 *
 * POST /scan {url}        -> free report (counts) + a scanId
 * GET  /report?id&t       -> paid report (fixes), only with a valid payment token
 * GET  /health
 *
 * Dependencies injected: scanImpl (the bundle scanner) and verifyPayment (a
 * check that the token proves a completed payment for this scanId). Scans are
 * held in a store so the paid report can be re-served after checkout; default is
 * in-memory, which is fine for a single free-tier instance.
 *
 * Read-only and stateless-per-request otherwise: it fetches only what a browser
 * downloads from the visitor's OWN url, and it contacts nobody.
 */
import { freeReport, paidReport } from '../../core/self-serve/report.js';

function parseQuery(path) {
  const q = path.indexOf('?');
  const params = {};
  if (q === -1) return { path, params };
  for (const pair of path.slice(q + 1).split('&')) {
    const [k, v] = pair.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return { path: path.slice(0, q), params };
}

export function createScanApp({ scanImpl, verifyPayment, store = new Map(), idgen = null } = {}) {
  const newId = idgen || (() => 's_' + Math.random().toString(36).slice(2, 12));

  async function handle(method, rawPath, body) {
    const { path, params } = parseQuery(rawPath);

    if (method === 'GET' && path === '/health') {
      return { status: 200, body: { ok: true } };
    }

    if (method === 'POST' && path === '/scan') {
      const url = body && typeof body.url === 'string' ? body.url.trim() : '';
      if (!url) return { status: 400, body: { error: 'a url is required' } };

      const target = url.startsWith('http') ? url : `https://${url}`;
      const scan = await scanImpl(target);
      if (!scan || scan.reachable === false) {
        return { status: 200, body: { reachable: false, message: `Could not reach ${target} — check the URL is a live, public site.` } };
      }

      const scanId = newId();
      store.set(scanId, { app: scan.app || target, findings: scan.findings || [] });
      return { status: 200, body: { scanId, ...freeReport({ app: scan.app || target, findings: scan.findings || [] }) } };
    }

    if (method === 'GET' && path === '/report') {
      const id = params.id;
      const record = id && store.get(id);
      if (!record) return { status: 404, body: { error: 'unknown scan id' } };

      const ok = await verifyPayment(id, params.t || '');
      if (!ok) return { status: 402, body: { error: 'payment required', scanId: id } };

      return { status: 200, body: paidReport(record) };
    }

    return { status: 404, body: { error: 'not found' } };
  }

  return { handle, store };
}
