import { getRuntimeConfig } from '../config.js';
import { ECONOMIC_DECISION, scoreEconomicOpportunity } from '../economic-selector.js';
import { RailAdapter, RAIL_MODE } from './base.js';

export const DESKCREW_ORIGIN = 'https://deskcrew.io';
export const DESKCREW_CONTESTS_PATH = '/api/arena/contests';
export const DESKCREW_CATALOG_PATH = '/.well-known/x402';
const MAX_RESPONSE_BYTES = 1_048_576;
const OPEN_STATES = new Set(['open', 'active', 'available']);

function invalidData(reason) {
  const error = new Error(`Invalid DeskCrew data: ${reason}`);
  error.code = 'DESKCREW_DATA_INVALID';
  return error;
}

function finite(value, { min = 0, max = Number.MAX_SAFE_INTEGER, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw invalidData('required numeric field missing');
    return null;
  }
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result) || result < min || result > max) throw invalidData('numeric field out of range');
  return result;
}

function boundedText(value, fallback, max = 300) {
  const text = String(value || fallback || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!text) throw invalidData('required text field missing');
  return text.slice(0, max);
}

function extractRows(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : payload?.contests || payload?.bounties || payload?.data?.contests || payload?.data?.bounties || payload?.data;
  if (!Array.isArray(rows)) throw invalidData('contest collection missing');
  return rows;
}

function submissionFeeFrom(catalog, raw) {
  const rawFee = finite(raw.submissionFeeUsd ?? raw.submissionFee ?? raw.entryFeeUsd);
  if (rawFee !== null) return rawFee;
  const action = Array.isArray(catalog?.actions)
    ? catalog.actions.find(item => item?.name === 'draft_reply')
    : null;
  return finite(action?.priceUsd);
}

function workerShareFrom(raw) {
  const direct = finite(raw.workerShare ?? raw.agentShare, { min: 0, max: 1 });
  if (direct !== null) return direct;
  const percentage = finite(raw.workerSharePct ?? raw.agentSharePct, { min: 0, max: 100 });
  if (percentage !== null) return percentage / 100;
  const reward = finite(raw.bountyUsd ?? raw.rewardUsd ?? raw.reward ?? raw.bounty);
  const shareUsd = finite(raw.workerShareUsd ?? raw.agentShareUsd ?? raw.payoutUsd);
  return reward && shareUsd !== null ? shareUsd / reward : null;
}

function explicitProbability(raw, names) {
  for (const name of names) {
    const value = finite(raw[name], { min: 0, max: 1 });
    if (value !== null) return value;
  }
  return null;
}

export function normalizeDeskCrewOpportunity(raw = {}, {
  catalog = {},
  observedAt,
  sourceUrl = `${DESKCREW_ORIGIN}${DESKCREW_CONTESTS_PATH}`
} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidData('contest row must be an object');
  const taskId = boundedText(raw.ticketId ?? raw.contestId ?? raw.taskId ?? raw.id, null, 120);
  const status = String(raw.status ?? raw.state ?? '').toLowerCase();
  const isOpen = OPEN_STATES.has(status);
  const reward = finite(raw.bountyUsd ?? raw.rewardUsd ?? raw.reward ?? raw.bounty, { required: true });
  const entrantCount = finite(raw.entrants ?? raw.entrantCount ?? raw.submissionsCount, { required: true });
  if (!Number.isSafeInteger(entrantCount)) throw invalidData('entrant count must be a whole number');
  const availableSlots = finite(raw.availableSlots ?? raw.slots ?? raw.winners, { min: 1 }) ?? 1;
  if (!Number.isSafeInteger(availableSlots)) throw invalidData('available slots must be a whole number');
  const workerShare = workerShareFrom(raw);
  const submissionFee = submissionFeeFrom(catalog, raw);
  const payoutNetwork = raw.payoutNetwork ?? raw.payoutChain ?? raw.network;
  const observedAtMs = Date.parse(observedAt || '');
  if (!Number.isFinite(observedAtMs)) throw invalidData('observation timestamp missing or invalid');
  const timestamp = new Date(observedAtMs).toISOString();
  const rowEvidence = `${sourceUrl}#ticket-${encodeURIComponent(taskId)}`;

  const pEligible = raw.eligible === true ? 1 : explicitProbability(raw, ['eligibilityProbability', 'pEligible']);
  const pClaim = isOpen && raw.entryLimitReached !== true ? 1 : 0;
  const pAccept = explicitProbability(raw, ['acceptanceProbability', 'approvalProbability', 'pAccept'])
    ?? Math.min(1, availableSlots / (entrantCount + 1));
  const pPayout = explicitProbability(raw, ['payoutProbability', 'settlementProbability', 'pPayout'])
    ?? ((raw.funded === true || raw.escrowed === true) && payoutNetwork ? 1 : null);

  const probabilityEvidence = {
    ...(pEligible !== null ? { pEligible: rowEvidence } : {}),
    pClaim: rowEvidence,
    pAccept: `${rowEvidence}:competition-model`,
    ...(pPayout !== null ? { pPayout: rowEvidence } : {})
  };
  const requiredCapabilities = ['deskcrew.bounties.read'];
  const economicInput = {
    id: `deskcrew:${taskId}`,
    rail: 'deskcrew',
    title: boundedText(raw.title ?? raw.subject ?? raw.question, `DeskCrew bounty ${taskId}`),
    reward,
    workerShare,
    upfrontFee: submissionFee,
    aiCost: finite(raw.estimatedToolCostUsd ?? raw.aiCostUsd) ?? 0,
    pEligible: pEligible ?? undefined,
    pClaim,
    pAccept,
    pPayout: pPayout ?? undefined,
    probabilityEvidence,
    observedAt: timestamp,
    isOpen,
    requiredCapabilities
  };
  const selectorScore = scoreEconomicOpportunity({
    ...economicInput,
    workerShare: workerShare ?? 0,
    upfrontFee: submissionFee ?? 0
  }, {
    capabilities: { 'deskcrew.bounties.read': { status: 'available' } },
    nowMs: Date.parse(timestamp)
  });
  const missingEconomicTerms = Object.freeze([
    ...(workerShare === null ? ['workerShare'] : []),
    ...(submissionFee === null ? ['submissionFee'] : [])
  ]);
  const economicScore = missingEconomicTerms.length
    ? Object.freeze({
        ...selectorScore,
        decision: ECONOMIC_DECISION.NEEDS_EVIDENCE,
        reason: 'economic_terms_missing',
        missingEconomicTerms
      })
    : Object.freeze({ ...selectorScore, missingEconomicTerms });

  return Object.freeze({
    candidateId: `deskcrew:${taskId}`,
    sourceType: 'immediate_income',
    profile: 'immediate_income_v1',
    noveltyKey: `deskcrew-bounty-${taskId}`,
    title: economicInput.title,
    moneyFlow: 'funded support bounty → human-approved grounded draft → USDC payout',
    trigger: 'observed open DeskCrew bounty',
    estimatedValue: null,
    evidence: Object.freeze([sourceUrl, rowEvidence]),
    sourceTimestamp: timestamp,
    confidence: 0,
    metrics: Object.freeze({
      reward,
      entrantCount,
      availableSlots,
      submissionFee,
      workerShare,
      payoutNetwork: payoutNetwork ? boundedText(payoutNetwork, null, 40).toLowerCase() : null,
      expectedNetValue: economicScore.ev.expectedNetValue,
      economicDecision: economicScore.decision
    }),
    requiredCapabilities: Object.freeze(requiredCapabilities),
    executionRequiredCapabilities: Object.freeze([
      'deskcrew.ticket_context.read',
      'deskcrew.draft.submit',
      'x402.payment',
      'wallet.receive_usdc'
    ]),
    nextValidation: 'Refresh the row, context, x402 quote, chain compatibility, probability evidence, and authorization before any execution.',
    acceptanceCriteria: null,
    isOpen,
    economicInput: Object.freeze(economicInput),
    economicScore,
    untrustedSource: true
  });
}

export class DeskCrewRailAdapter extends RailAdapter {
  constructor({
    enabled = getRuntimeConfig().rails.deskcrew.enabled,
    fetchImpl = globalThis.fetch,
    timeoutMs = 10_000
  } = {}) {
    super({ name: 'deskcrew', mode: RAIL_MODE.READ_ONLY });
    this.enabled = enabled === true;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async health() {
    return {
      name: this.name,
      mode: this.mode,
      enabled: this.enabled,
      configured: this.enabled,
      baseUrl: DESKCREW_ORIGIN,
      safeDefault: true,
      writeAdapterAvailable: false
    };
  }

  async discover({ signal } = {}) {
    if (!this.enabled) {
      return { ok: false, blocked: true, retryable: false, reason: 'DESKCREW_ENABLED is false', bounties: [] };
    }
    const observedAt = new Date().toISOString();
    try {
      const [payload, catalog] = await Promise.all([
        this.#readJson(DESKCREW_CONTESTS_PATH, signal),
        this.#readJson(DESKCREW_CATALOG_PATH, signal)
      ]);
      return { ok: true, observedAt, bounties: this.listOpenBounties({ payload, catalog, observedAt }) };
    } catch (cause) {
      const error = new Error('DeskCrew read-only discovery failed', { cause });
      error.code = 'DESKCREW_READ_FAILED';
      error.retryable = true;
      throw error;
    }
  }

  listOpenBounties({ payload, catalog = {}, observedAt = new Date().toISOString() } = {}) {
    const seen = new Set();
    const candidates = [];
    for (const raw of extractRows(payload)) {
      const candidate = normalizeDeskCrewOpportunity(raw, { catalog, observedAt });
      if (!candidate.isOpen || seen.has(candidate.noveltyKey)) continue;
      seen.add(candidate.noveltyKey);
      candidates.push(candidate);
    }
    return candidates;
  }

  async verify(candidate) {
    return {
      candidate,
      economicScore: candidate?.economicScore || null,
      executionReady: false,
      reason: 'DeskCrew write, payment, wallet, and payout adapters are unavailable'
    };
  }

  async submitGroundedDraft() {
    const error = new Error('DeskCrew submission is unavailable: no authorized write adapter is installed');
    error.code = 'DESKCREW_WRITE_ADAPTER_UNAVAILABLE';
    throw error;
  }

  async #readJson(path, signal) {
    const combinedSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)])
      : AbortSignal.timeout(this.timeoutMs);
    const response = await this.fetchImpl(`${DESKCREW_ORIGIN}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: combinedSignal
    });
    if (!response?.ok) {
      const error = new Error(`DeskCrew GET failed with HTTP ${response?.status || 0}`);
      error.status = response?.status || 0;
      throw error;
    }
    const declaredLength = Number(response.headers?.get?.('content-length') || 0);
    if (declaredLength > MAX_RESPONSE_BYTES) throw invalidData('response too large');
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw invalidData('response too large');
    try {
      return JSON.parse(text);
    } catch {
      throw invalidData('response was not JSON');
    }
  }
}

export function createDeskCrewRail(options) {
  return new DeskCrewRailAdapter(options);
}
