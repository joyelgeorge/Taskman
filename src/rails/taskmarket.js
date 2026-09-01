import { getRuntimeConfig } from '../config.js';
import { ECONOMIC_DECISION, scoreEconomicOpportunity } from '../economic-selector.js';
import { RailAdapter, RAIL_MODE } from './base.js';

export const TASKMARKET_ORIGIN = 'https://api.taskmarket.dev';
export const TASKMARKET_TASKS_PATH = '/api/tasks';
const MAX_RESPONSE_BYTES = 1_048_576;
const VALID_MODES = new Set(['bounty', 'claim', 'pitch', 'benchmark', 'auction']);
const VALID_STATUSES = new Set(['open', 'claimed', 'worker_selected', 'pending_approval', 'review', 'appealing', 'disputed', 'completed', 'expired', 'cancelled']);

function invalid(reason) {
  const error = new Error(`Invalid Taskmarket data: ${reason}`);
  error.code = 'TASKMARKET_DATA_INVALID';
  return error;
}

function text(value, name, max = 300) {
  const normalized = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!normalized || normalized.length > max) throw invalid(`${name} missing or too long`);
  return normalized;
}

function whole(value, name, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw invalid(`${name} invalid`);
  return value;
}

function money(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw invalid(`${name} invalid`);
  return value;
}

function time(value, name) {
  const ms = Date.parse(value || '');
  if (!Number.isFinite(ms)) throw invalid(`${name} missing or invalid`);
  return { ms, iso: new Date(ms).toISOString() };
}

function explicitProbability(raw, name, evidence) {
  if (raw[name] === undefined || raw[name] === null) return null;
  if (typeof raw[name] !== 'number' || !Number.isFinite(raw[name]) || raw[name] < 0 || raw[name] > 1) {
    throw invalid(`${name} invalid`);
  }
  const reference = raw.probabilityEvidence?.[name];
  if (typeof reference !== 'string' || !reference.startsWith('https://')) return null;
  evidence[name] = reference;
  return raw[name];
}

export function usdcBaseUnitsToUsd(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw invalid('reward must be a USDC base-unit string');
  const atomic = BigInt(value);
  const wholePart = atomic / 1_000_000n;
  if (wholePart > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid('reward out of range');
  return Number(wholePart) + Number(atomic % 1_000_000n) / 1_000_000;
}

export function normalizeTaskmarketOpportunity(raw = {}, {
  observedAt,
  sourceUrl = `${TASKMARKET_ORIGIN}${TASKMARKET_TASKS_PATH}`,
  nowMs
} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('task row must be an object');
  const taskId = text(raw.id, 'id', 160);
  const description = text(raw.description, 'description', 10_000);
  const mode = text(raw.mode, 'mode', 40).toLowerCase();
  const status = text(raw.status, 'status', 40).toLowerCase();
  if (!VALID_MODES.has(mode)) throw invalid('mode invalid');
  if (!VALID_STATUSES.has(status)) throw invalid('status invalid');
  const reward = usdcBaseUnitsToUsd(raw.reward);
  const submissionCount = whole(raw.submissionCount, 'submissionCount');
  const createdAt = time(raw.createdAt, 'createdAt');
  const expiryTime = time(raw.expiryTime, 'expiryTime');
  const observed = time(observedAt, 'observedAt');
  const isOpen = status === 'open' && expiryTime.ms > (nowMs ?? observed.ms);
  const platformFeeBps = raw.platformFeeBps == null ? null : whole(raw.platformFeeBps, 'platformFeeBps', 10_000);
  const workerShare = platformFeeBps === null ? null : 1 - platformFeeBps / 10_000;
  const submissionFee = money(raw.submissionFeeUsd, 'submissionFeeUsd');
  const artifactCost = money(raw.artifactCostUsd, 'artifactCostUsd');
  const probabilityEvidence = {};
  const probabilities = Object.fromEntries(['pEligible', 'pClaim', 'pAccept', 'pPayout']
    .map(name => [name, explicitProbability(raw, name, probabilityEvidence)]));
  const slots = Number.isSafeInteger(raw.awardCount) && raw.awardCount > 0 ? raw.awardCount : 1;
  const competitionSanityBound = Math.min(1, slots / (submissionCount + slots));
  const detailUrl = `${TASKMARKET_ORIGIN}${TASKMARKET_TASKS_PATH}/${encodeURIComponent(taskId)}`;
  const requiredCapabilities = ['taskmarket.read', 'taskmarket.task.read'];
  const economicInput = {
    id: `taskmarket:${taskId}`,
    rail: 'taskmarket',
    title: description.split(/\r?\n/, 1)[0].slice(0, 300),
    reward,
    workerShare: workerShare ?? 0,
    upfrontFee: submissionFee ?? 0,
    aiCost: artifactCost ?? 0,
    ...Object.fromEntries(Object.entries(probabilities).map(([key, value]) => [key, value ?? undefined])),
    probabilityEvidence,
    observedAt: observed.iso,
    isOpen,
    requiredCapabilities
  };
  const selected = scoreEconomicOpportunity(economicInput, {
    capabilities: Object.fromEntries(requiredCapabilities.map(id => [id, { status: 'available' }])),
    nowMs: observed.ms
  });
  const missingEconomicTerms = [
    ...(platformFeeBps === null ? ['platformFeeBps'] : []),
    ...(submissionFee === null ? ['submissionFeeUsd'] : []),
    ...(artifactCost === null ? ['artifactCostUsd'] : [])
  ];
  const economicScore = isOpen && missingEconomicTerms.length
    ? Object.freeze({ ...selected, decision: ECONOMIC_DECISION.NEEDS_EVIDENCE, reason: 'economic_terms_missing', missingEconomicTerms: Object.freeze(missingEconomicTerms) })
    : Object.freeze({ ...selected, missingEconomicTerms: Object.freeze(missingEconomicTerms) });

  return Object.freeze({
    candidateId: `taskmarket:${taskId}`,
    sourceType: 'immediate_income',
    profile: 'immediate_income_v1',
    noveltyKey: `taskmarket-task-${taskId}`,
    title: economicInput.title,
    moneyFlow: 'Taskmarket escrow → separately authorized work → reconciled USDC payout',
    trigger: 'observed canonical Taskmarket task',
    estimatedValue: null,
    evidence: Object.freeze([sourceUrl, detailUrl]),
    sourceTimestamp: observed.iso,
    confidence: 0,
    metrics: Object.freeze({ reward, submissionCount, mode, status, createdAt: createdAt.iso, expiryTime: expiryTime.iso,
      platformFeeBps, workerShare, submissionFee, artifactCost, competitionSanityBound,
      expectedNetValue: economicScore.ev.expectedNetValue, economicDecision: economicScore.decision }),
    requiredCapabilities: Object.freeze(requiredCapabilities),
    executionRequiredCapabilities: Object.freeze(['taskmarket.submit', 'wallet.receive_usdc.base', 'wallet.sign.eip191']),
    nextValidation: 'Refresh canonical detail and obtain evidence-bound probabilities, costs, authorization, and settlement proof.',
    acceptanceCriteria: null,
    isOpen,
    economicInput: Object.freeze(economicInput),
    economicScore,
    untrustedSource: true
  });
}

export class TaskmarketRailAdapter extends RailAdapter {
  constructor({ enabled = getRuntimeConfig().rails.taskmarket.enabled, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
    super({ name: 'taskmarket', mode: RAIL_MODE.READ_ONLY });
    this.enabled = enabled === true;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async health() {
    return { name: this.name, mode: this.mode, enabled: this.enabled, configured: this.enabled,
      baseUrl: TASKMARKET_ORIGIN, safeDefault: true, writeAdapterAvailable: false };
  }

  async discover({ signal, limit = 100, maxPages = 5 } = {}) {
    if (!this.enabled) return { ok: false, blocked: true, retryable: false, reason: 'TASKMARKET_ENABLED is false', tasks: [] };
    const observedAt = new Date().toISOString();
    const seen = new Set();
    const tasks = [];
    let cursor = null;
    try {
      for (let page = 0; page < Math.min(5, maxPages); page += 1) {
        const query = new URLSearchParams({ status: 'open', sort: 'newest', limit: String(Math.min(100, Math.max(1, limit))) });
        if (cursor) query.set('cursor', cursor);
        const payload = await this.#readJson(`${TASKMARKET_TASKS_PATH}?${query}`, signal);
        if (!Array.isArray(payload?.tasks)) throw invalid('task collection missing');
        for (const row of payload.tasks) {
          const candidate = normalizeTaskmarketOpportunity(row, { observedAt });
          if (!candidate.isOpen || seen.has(candidate.noveltyKey)) continue;
          seen.add(candidate.noveltyKey);
          tasks.push(candidate);
        }
        if (!payload.hasMore) break;
        cursor = text(payload.nextCursor, 'nextCursor', 500);
      }
      return { ok: true, observedAt, tasks };
    } catch (cause) {
      const error = new Error('Taskmarket read-only discovery failed', { cause });
      error.code = 'TASKMARKET_READ_FAILED';
      error.retryable = true;
      throw error;
    }
  }

  async fetchOpportunity(taskId, { signal } = {}) {
    const observedAt = new Date().toISOString();
    const row = await this.#readJson(`${TASKMARKET_TASKS_PATH}/${encodeURIComponent(text(taskId, 'taskId', 160))}`, signal);
    return normalizeTaskmarketOpportunity(row, { observedAt });
  }

  async verify(candidate) {
    return { candidate, economicScore: candidate?.economicScore || null, executionReady: false,
      reason: 'Taskmarket signing, submission, payment, wallet, and payout adapters are unavailable' };
  }

  async submitTaskArtifact() {
    const error = new Error('Taskmarket submission is unavailable: no authorized write adapter is installed');
    error.code = 'TASKMARKET_WRITE_ADAPTER_UNAVAILABLE';
    throw error;
  }

  async #readJson(path, signal) {
    const combinedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
    const response = await this.fetchImpl(`${TASKMARKET_ORIGIN}${path}`, {
      method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', signal: combinedSignal
    });
    if (!response?.ok) throw new Error(`Taskmarket GET failed with HTTP ${response?.status || 0}`);
    const declared = Number(response.headers?.get?.('content-length') || 0);
    if (declared > MAX_RESPONSE_BYTES) throw invalid('response too large');
    const body = await response.text();
    if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw invalid('response too large');
    try { return JSON.parse(body); } catch { throw invalid('response was not JSON'); }
  }
}

export function createTaskmarketRail(options) {
  return new TaskmarketRailAdapter(options);
}
