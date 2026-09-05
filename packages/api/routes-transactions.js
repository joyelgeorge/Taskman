import { listSettlements, listAttempts } from '@taskman/core';

/**
 * Row-level ledger reads. Aggregates stay on /api/money/economics;
 * this module exists so the dashboard can show why those sums are zero.
 */
export async function routeTransactions(req, url) {
  const { pathname } = url;
  if (req.method !== 'GET') return null;

  if (pathname === '/api/money/settlements') {
    const rail = url.searchParams.get('rail') || null;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
    return { status: 200, body: { settlements: await listSettlements({ rail, limit }) } };
  }

  if (pathname === '/api/money/attempts') {
    const rail = url.searchParams.get('rail') || null;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
    return { status: 200, body: { attempts: await listAttempts({ rail, limit }) } };
  }

  return null;
}
