import { RailAdapter, RAIL_MODE } from './base.js';
import { getRuntimeConfig } from '../config.js';

const DEFAULT_BASE_URL = 'https://ugig.net';
const OPEN_GIG_STATUSES = new Set(['active', 'open', 'available']);

export class UgigRail extends RailAdapter {
  constructor({
    apiKey = getRuntimeConfig().rails.ugig.apiKey,
    baseUrl = getRuntimeConfig().rails.ugig.baseUrl || DEFAULT_BASE_URL,
    mode = RAIL_MODE.READ_ONLY,
    fetchImpl = globalThis.fetch,
    walletCapabilities = {}
  } = {}) {
    super({ name: 'ugig', mode });
    this.apiKey = apiKey || null;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.walletCapabilities = walletCapabilities;
  }

  capabilities() {
    const authenticatedRead = this.apiKey ? 'available' : 'setup_required';
    return {
      'ugig.gigs.read': 'available',
      'ugig.gig.read': 'available',
      'ugig.poster.read': 'available',
      'ugig.invoice.read': authenticatedRead,
      'ugig.payment.read': authenticatedRead,
      'ugig.apply': 'setup_required',
      'ugig.message': 'setup_required',
      'ugig.invoice.create': 'setup_required'
    };
  }

  async health() {
    return {
      name: this.name,
      mode: this.mode,
      configured: Boolean(this.apiKey),
      baseUrl: this.baseUrl,
      capabilities: this.capabilities(),
      safeDefault: this.mode === RAIL_MODE.READ_ONLY
    };
  }

  async discover(filters = {}) {
    const query = new URLSearchParams();
    for (const key of ['search', 'category', 'skills', 'budget_min', 'budget_max', 'sort', 'limit', 'offset']) {
      if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
        query.set(key, String(filters[key]));
      }
    }
    const result = await this.#read(`/api/gigs${query.size ? `?${query}` : ''}`);
    const gigs = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : [];
    return {
      ok: true,
      candidates: gigs.map(normalizeUgigGig),
      pagination: result?.pagination || null
    };
  }

  async getGig(gigId) {
    requireIdentifier(gigId, 'gigId');
    const result = await this.#read(`/api/gigs/${encodeURIComponent(gigId)}`);
    return normalizeUgigGig(result?.data || result);
  }

  async getPoster(username) {
    requireIdentifier(username, 'username');
    return this.#read(`/api/users/${encodeURIComponent(username)}`);
  }

  async getPosterReviews(username) {
    requireIdentifier(username, 'username');
    return this.#read(`/api/users/${encodeURIComponent(username)}/reviews`);
  }

  async getPosterActivity(username) {
    requireIdentifier(username, 'username');
    return this.#read(`/api/users/${encodeURIComponent(username)}/activity`);
  }

  async getInvoices(gigId) {
    requireIdentifier(gigId, 'gigId');
    if (!this.apiKey) {
      return {
        ok: false,
        blocked: true,
        classification: 'NEEDS_EVIDENCE',
        reason: 'UGIG_API_KEY missing; invoice evidence requires an authenticated read',
        invoices: []
      };
    }
    const result = await this.#read(`/api/gigs/${encodeURIComponent(gigId)}/invoice`, { authenticated: true });
    return { ok: true, invoices: Array.isArray(result?.data) ? result.data : [] };
  }

  async verify(gig, evidence = {}) {
    const candidate = normalizeUgigGig(gig);
    return {
      candidate,
      gate: evaluateUgigFundingGate(candidate, {
        ...evidence,
        walletCapabilities: evidence.walletCapabilities || this.walletCapabilities
      })
    };
  }

  async apply() {
    this.assertExecutable('apply');
    throw new Error('uGig apply is not configured; explicit write authorization is required');
  }

  async message() {
    this.assertExecutable('message');
    throw new Error('uGig messaging is not configured; explicit write authorization is required');
  }

  async createInvoice() {
    this.assertExecutable('invoice creation');
    throw new Error('uGig invoice creation is not configured; explicit write authorization is required');
  }

  async #read(path, { authenticated = false } = {}) {
    if (typeof this.fetch !== 'function') throw new Error('fetch implementation is required');
    const headers = { accept: 'application/json' };
    if (authenticated) headers['x-api-key'] = this.apiKey;
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const error = new Error(`uGig GET ${path.split('?')[0]} failed: HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
}

export function normalizeUgigGig(gig = {}) {
  const budgetMin = finiteNumber(gig.budget_min ?? gig.budgetMin);
  const budgetMax = finiteNumber(gig.budget_max ?? gig.budgetMax);
  const rewardAmount = budgetMax ?? budgetMin ?? finiteNumber(gig.reward?.amount ?? gig.reward) ?? 0;
  const currency = String(gig.payment_coin || gig.currency || gig.reward?.currency || 'USD').toUpperCase();
  const poster = gig.poster || {};
  const applicationCount = finiteNumber(
    gig.applications_count ?? gig.application_count ?? gig.applicationCount ??
    (Array.isArray(gig.applications) ? gig.applications.length : null)
  ) ?? 0;

  return {
    id: gig.id || gig.gig_id || null,
    source: 'ugig',
    profile: 'immediate_income_v1',
    title: gig.title || '',
    description: gig.description || '',
    status: String(gig.status || '').toLowerCase(),
    taskOpen: OPEN_GIG_STATUSES.has(String(gig.status || '').toLowerCase()),
    acceptanceCriteriaClear: Boolean(gig.acceptance_criteria || gig.acceptanceCriteria || gig.acceptanceCriteriaClear),
    applicationCount,
    reward: { amount: rewardAmount, currency },
    poster: {
      username: poster.username || gig.poster_username || null,
      averageRating: finiteNumber(poster.average_rating ?? poster.avg_rating ?? poster.rating ?? poster.averageRating),
      reviewsCount: finiteNumber(poster.reviews_count ?? poster.review_count ?? poster.reviewsCount) ?? 0,
      completedGigs: finiteNumber(poster.completed_gigs ?? poster.completed_count ?? poster.completedGigs) ?? 0,
      createdAt: poster.created_at || poster.createdAt || null,
      walletCurrencies: poster.wallet_currencies || poster.wallets || poster.walletCurrencies || []
    },
    realizedRevenue: {
      verified: false,
      amount: 0,
      currency,
      source: null
    },
    raw: gig
  };
}

export function evaluateUgigFundingGate(candidate, {
  application = null,
  invoices = [],
  walletCapabilities = {},
  acceptanceProbability = 0.5,
  aiToolCostUsd = 0,
  otherToolCostUsd = 0
} = {}) {
  const invoiceList = Array.isArray(invoices) ? invoices : [];
  const invoice = selectBestInvoice(invoiceList);
  const engagementExists = ['accepted', 'engaged', 'hired'].includes(String(application?.status || '').toLowerCase()) ||
    application?.accepted === true;
  const invoiceStatus = String(invoice?.status || '').toLowerCase();
  const invoiceAmount = finiteNumber(invoice?.amount_usd ?? invoice?.amount) ?? 0;
  const rewardAmount = finiteNumber(candidate?.reward?.amount) ?? 0;
  const invoiceCoversReward = rewardAmount > 0 && invoiceAmount >= rewardAmount;
  const fundingVerified = invoiceStatus === 'paid' && Boolean(invoice?.coinpay_invoice_id) && invoiceCoversReward;
  const payoutCurrency = String(invoice?.currency || candidate?.reward?.currency || '').toUpperCase();
  const payoutCompatible = canReceiveCurrency(walletCapabilities, payoutCurrency);

  const posterRiskReasons = [];
  if ((candidate?.poster?.reviewsCount ?? 0) === 0) posterRiskReasons.push('poster_has_no_reviews');
  if ((candidate?.poster?.completedGigs ?? 0) === 0) posterRiskReasons.push('poster_has_no_completed_gigs');
  if (!candidate?.poster?.walletCurrencies || candidate.poster.walletCurrencies.length === 0) {
    posterRiskReasons.push('poster_wallet_metadata_missing');
  }
  const boundedProbability = Math.max(0, Math.min(1, finiteNumber(acceptanceProbability) ?? 0.5));
  const riskMultiplier = Math.max(0.4, 1 - (posterRiskReasons.length * 0.15));
  const adjustedAcceptanceProbability = boundedProbability * riskMultiplier;
  const toolCostUsd = Math.max(0, finiteNumber(aiToolCostUsd) ?? 0) + Math.max(0, finiteNumber(otherToolCostUsd) ?? 0);
  const expectedValueUsd = Number(((rewardAmount * adjustedAcceptanceProbability) - toolCostUsd).toFixed(2));

  const missingEvidence = [];
  if (!engagementExists) missingEvidence.push('accepted_engagement');
  if (!candidate?.acceptanceCriteriaClear) missingEvidence.push('bounded_acceptance_criteria');
  if (!invoice) missingEvidence.push('invoice');
  else if (!fundingVerified) missingEvidence.push('paid_invoice_with_sufficient_amount');

  let classification = 'EXECUTABLE';
  const blockers = [];
  if (!candidate?.taskOpen) {
    classification = 'BLOCKED';
    blockers.push('gig_not_open');
  } else if (missingEvidence.length > 0) {
    classification = 'NEEDS_EVIDENCE';
  } else if (!payoutCompatible) {
    classification = 'BLOCKED';
    blockers.push('payout_wallet_incompatible');
  } else if (expectedValueUsd <= 0) {
    classification = 'BLOCKED';
    blockers.push('non_positive_expected_value');
  }

  return {
    classification,
    executable: classification === 'EXECUTABLE',
    engagementExists,
    acceptanceCriteriaClear: Boolean(candidate?.acceptanceCriteriaClear),
    fundingVerified,
    invoiceStatus: invoiceStatus || null,
    invoiceId: invoice?.id || null,
    payoutCurrency: payoutCurrency || null,
    payoutCompatible,
    expectedValueUsd,
    toolCostUsd,
    adjustedAcceptanceProbability: Number(adjustedAcceptanceProbability.toFixed(4)),
    posterRisk: posterRiskReasons.length >= 2 ? 'high' : posterRiskReasons.length ? 'medium' : 'low',
    posterRiskReasons,
    missingEvidence,
    blockers,
    economicTruth: {
      verifiedRevenue: false,
      realizedRevenueAmount: 0,
      note: 'Gig rewards and expected value are opportunities, not realized revenue.'
    }
  };
}

function selectBestInvoice(invoices) {
  const rank = { paid: 3, sent: 2, expired: 1, cancelled: 0 };
  return [...invoices]
    .filter(Boolean)
    .sort((a, b) => (rank[String(b.status || '').toLowerCase()] ?? -1) - (rank[String(a.status || '').toLowerCase()] ?? -1))[0] || null;
}

function canReceiveCurrency(capabilities, currency) {
  if (!currency) return false;
  const normalized = currency.toLowerCase();
  if (Array.isArray(capabilities)) return capabilities.map((value) => String(value).toLowerCase()).includes(normalized);
  return capabilities[`wallet.receive_${normalized}`] === true || capabilities[normalized] === true;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requireIdentifier(value, name) {
  if (!value) throw new Error(`${name} is required`);
}

export function createUgigRail(options) { return new UgigRail(options); }
