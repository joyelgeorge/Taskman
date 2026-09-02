import {
  recordSettlement,
  markSettlementCleared,
  SETTLEMENT_STATUS
} from './money-ledger.js';

/**
 * Reads settled money out of a payment processor and into the ledger.
 *
 * The measured state of agent-work venues in 2026 is that completion is solved and
 * settlement is not: work is accepted and the money never arrives. So the ledger is
 * fed from the processor's own balance rather than from any marketplace's claim
 * that a job was approved.
 *
 * Every call here is a GET. This module never moves money.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

export function normalizeStripeTransaction(txn = {}, rail) {
  if (!txn.id) throw new Error('stripe transaction is missing an id');
  return {
    rail,
    source: 'stripe',
    externalRef: txn.id,
    grossCents: Math.round(Number(txn.amount || 0)),
    feeCents: Math.round(Number(txn.fee || 0)),
    currency: String(txn.currency || 'usd').toUpperCase(),
    // 'available' means the money is in the balance and withdrawable. Anything else
    // is a promise, and promises are what the agent job boards already fail on.
    status: txn.status === 'available' ? SETTLEMENT_STATUS.CLEARED : SETTLEMENT_STATUS.PENDING,
    verification: {
      stripeStatus: txn.status || null,
      type: txn.type || null,
      description: txn.description || null,
      createdAt: txn.created ? new Date(txn.created * 1000).toISOString() : null,
      checkedAt: new Date().toISOString()
    }
  };
}

export async function fetchStripeBalanceTransactions({
  apiKey = process.env.STRIPE_API_KEY,
  since = null,
  limit = 100,
  type = 'charge',
  fetchImpl = fetch
} = {}) {
  if (!apiKey) throw new Error('STRIPE_API_KEY is required');

  const params = new URLSearchParams({ limit: String(Math.min(Math.max(Number(limit) || 100, 1), 100)) });
  if (type) params.set('type', type);
  if (since) params.set('created[gte]', String(Math.floor(new Date(since).getTime() / 1000)));

  const response = await fetchImpl(`${STRIPE_API}/balance_transactions?${params}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });

  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok) {
    const error = new Error(`Stripe balance_transactions failed: HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return Array.isArray(body?.data) ? body.data : [];
}

/**
 * Pull the processor balance into the ledger. Returns what was actually verified,
 * never what was hoped for.
 */
export async function syncStripeSettlements({ rail, since = null, apiKey, fetchImpl, limit } = {}) {
  if (!rail) throw new Error('rail is required');

  const transactions = await fetchStripeBalanceTransactions({ apiKey, since, fetchImpl, limit });
  const recorded = [];
  const skipped = [];

  for (const txn of transactions) {
    try {
      const normalized = normalizeStripeTransaction(txn, rail);
      if (normalized.grossCents <= 0) {
        skipped.push({ externalRef: txn.id, reason: 'non-positive amount (refund or adjustment)' });
        continue;
      }
      const settlement = await recordSettlement(normalized);
      if (normalized.status === SETTLEMENT_STATUS.CLEARED && settlement.status !== SETTLEMENT_STATUS.CLEARED) {
        await markSettlementCleared('stripe', normalized.externalRef, normalized.verification);
      }
      recorded.push(settlement);
    } catch (error) {
      skipped.push({ externalRef: txn?.id || null, reason: String(error.message || error) });
    }
  }

  return {
    rail,
    source: 'stripe',
    scanned: transactions.length,
    recordedCount: recorded.length,
    clearedCount: recorded.filter(s => s.status === SETTLEMENT_STATUS.CLEARED).length,
    recorded,
    skipped,
    syncedAt: new Date().toISOString()
  };
}
