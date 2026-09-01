import { CAPABILITY_STATUS, buildCapabilityRegistry } from './capability-registry.js';
import { AppError, sendJson } from './errors.js';
import { readJsonBody } from './limits.js';

export const ECONOMIC_DECISION = Object.freeze({
  ENTER: 'ENTER',
  SETUP_REQUIRED: 'SETUP_REQUIRED',
  BLOCKED: 'BLOCKED',
  SKIP: 'SKIP',
  NEEDS_EVIDENCE: 'NEEDS_EVIDENCE'
});

export const DEFAULT_SELECTOR_CONFIG = Object.freeze({
  minExpectedNetValue: 0.05,
  maxEvidenceAgeMs: 5 * 60 * 1000
});

const PROBABILITY_FIELDS = Object.freeze(['pEligible', 'pClaim', 'pAccept', 'pPayout']);
const COST_FIELDS = Object.freeze(['upfrontFee', 'aiToolCost', 'platformFee', 'riskReserve']);

function invalid() {
  throw new AppError('INVALID_REQUEST');
}

function finiteNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < min || candidate > max) invalid();
  return candidate;
}

function money(value, fallback = 0) {
  return finiteNumber(value, { fallback });
}

function probability(value, field, evidence, missingEvidence) {
  if (value === undefined || value === null) {
    missingEvidence.push(field);
    return 0;
  }
  const normalized = finiteNumber(value, { min: 0, max: 1 });
  if (typeof evidence?.[field] !== 'string' || evidence[field].trim() === '') missingEvidence.push(field);
  return normalized;
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function capabilityStatus(descriptor) {
  return typeof descriptor === 'string' ? descriptor : descriptor?.status;
}

function normalizedId(value, fallback) {
  const id = String(value || fallback || '').trim();
  if (!id || id.length > 200) invalid();
  return id;
}

/** Pure, deterministic expected-value calculation. It never supplies probability priors. */
export function calculateExpectedNetValue(input = {}) {
  const missingEvidence = [];
  const evidence = input.probabilityEvidence || {};
  const probabilities = {};
  for (const field of PROBABILITY_FIELDS) {
    probabilities[field] = probability(input[field], field, evidence, missingEvidence);
  }

  const grossReward = money(input.grossReward);
  const workerShare = finiteNumber(input.workerShare, { min: 0, max: 1, fallback: 1 });
  const costs = {};
  for (const field of COST_FIELDS) costs[field] = money(input[field]);

  const composite = PROBABILITY_FIELDS.reduce((value, field) => value * probabilities[field], 1);
  const grossExpectedValue = composite * grossReward * workerShare;
  const totalCost = COST_FIELDS.reduce((value, field) => value + costs[field], 0);
  const expectedNetValue = grossExpectedValue - totalCost;

  return Object.freeze({
    grossReward: rounded(grossReward),
    workerShare: rounded(workerShare),
    probabilities: Object.freeze({ ...probabilities, composite: rounded(composite) }),
    probabilityEvidence: Object.freeze(Object.fromEntries(
      PROBABILITY_FIELDS.filter(field => typeof evidence[field] === 'string' && evidence[field].trim())
        .map(field => [field, evidence[field].trim()])
    )),
    missingEvidence: Object.freeze([...new Set(missingEvidence)].sort()),
    costs: Object.freeze({ ...costs, totalCost: rounded(totalCost) }),
    grossExpectedValue: rounded(grossExpectedValue),
    expectedNetValue: rounded(expectedNetValue),
    isPositiveEv: expectedNetValue > 0,
    estimatedOnly: true,
    realizedValue: null,
    verifiedRevenue: null
  });
}

export function scoreEconomicOpportunity(opportunity = {}, {
  capabilities = {},
  config = DEFAULT_SELECTOR_CONFIG,
  nowMs = Date.now()
} = {}) {
  if (!opportunity || typeof opportunity !== 'object' || Array.isArray(opportunity)) invalid();
  const id = normalizedId(opportunity.id || opportunity.candidateId, 'unknown');
  const rail = normalizedId(opportunity.rail, 'generic');
  const requiredCapabilities = [...new Set(
    Array.isArray(opportunity.requiredCapabilities) ? opportunity.requiredCapabilities.map(value => normalizedId(value)) : []
  )].sort();
  const missingCapabilities = [];
  const setupRequiredCapabilities = [];
  const unhealthyCapabilities = [];

  for (const capability of requiredCapabilities) {
    const status = capabilityStatus(capabilities[capability]);
    if (status === CAPABILITY_STATUS.AVAILABLE) continue;
    if (status === CAPABILITY_STATUS.SETUP_REQUIRED) setupRequiredCapabilities.push(capability);
    else if (status === CAPABILITY_STATUS.UNHEALTHY) unhealthyCapabilities.push(capability);
    else missingCapabilities.push(capability);
  }

  const ev = calculateExpectedNetValue({
    grossReward: opportunity.reward,
    workerShare: opportunity.workerShare,
    upfrontFee: opportunity.upfrontFee,
    aiToolCost: opportunity.aiCost,
    platformFee: opportunity.platformFee,
    riskReserve: opportunity.riskReserve,
    pEligible: opportunity.pEligible,
    pClaim: opportunity.pClaim,
    pAccept: opportunity.pAccept,
    pPayout: opportunity.pPayout,
    probabilityEvidence: opportunity.probabilityEvidence
  });

  const observedAtMs = Date.parse(opportunity.observedAt || '');
  const evidenceFresh = Number.isFinite(observedAtMs)
    && observedAtMs <= nowMs
    && nowMs - observedAtMs <= finiteNumber(config.maxEvidenceAgeMs, { min: 1 });
  const minExpectedNetValue = money(config.minExpectedNetValue);
  let decision = ECONOMIC_DECISION.ENTER;
  let reason = 'positive_expected_net_value';

  if (opportunity.isOpen === false) {
    decision = ECONOMIC_DECISION.SKIP;
    reason = 'opportunity_closed';
  } else if (missingCapabilities.length || unhealthyCapabilities.length) {
    decision = ECONOMIC_DECISION.BLOCKED;
    reason = 'required_capability_unavailable';
  } else if (setupRequiredCapabilities.length) {
    decision = ECONOMIC_DECISION.SETUP_REQUIRED;
    reason = 'required_capability_setup_needed';
  } else if (!evidenceFresh || ev.missingEvidence.length) {
    decision = ECONOMIC_DECISION.NEEDS_EVIDENCE;
    reason = !evidenceFresh ? 'live_state_evidence_missing_or_stale' : 'probability_evidence_missing';
  } else if (ev.expectedNetValue < minExpectedNetValue) {
    decision = ECONOMIC_DECISION.SKIP;
    reason = 'expected_net_value_below_threshold';
  }

  return Object.freeze({
    id,
    rail,
    title: String(opportunity.title || 'Untitled Opportunity').slice(0, 300),
    decision,
    reason,
    requiredCapabilities: Object.freeze(requiredCapabilities),
    missingCapabilities: Object.freeze(missingCapabilities),
    setupRequiredCapabilities: Object.freeze(setupRequiredCapabilities),
    unhealthyCapabilities: Object.freeze(unhealthyCapabilities),
    evidenceFresh,
    observedAt: evidenceFresh ? opportunity.observedAt : null,
    ev,
    recommendationOnly: true,
    executionAuthorized: false,
    spendAuthorized: false,
    requiresSeparateSpendAuthorization: ev.costs.upfrontFee > 0
  });
}

export function rankEconomicOpportunities(opportunities = [], options = {}) {
  if (!Array.isArray(opportunities) || opportunities.length > 1_000) invalid();
  const priority = {
    [ECONOMIC_DECISION.ENTER]: 4,
    [ECONOMIC_DECISION.NEEDS_EVIDENCE]: 3,
    [ECONOMIC_DECISION.SETUP_REQUIRED]: 2,
    [ECONOMIC_DECISION.SKIP]: 1,
    [ECONOMIC_DECISION.BLOCKED]: 0
  };
  return opportunities.map(opportunity => scoreEconomicOpportunity(opportunity, options)).sort((a, b) =>
    priority[b.decision] - priority[a.decision]
      || b.ev.expectedNetValue - a.ev.expectedNetValue
      || a.rail.localeCompare(b.rail)
      || a.id.localeCompare(b.id)
  );
}

/** Read-only HTTP surface. Runtime capabilities are always built internally. */
export async function handleEconomicSelectorRequest(req, res, url, options = {}) {
  const route = url.pathname;
  if (req.method !== 'POST' || !['/api/economic-selector/score', '/api/economic-selector/rank'].includes(route)) return false;
  const capabilityRegistry = options.capabilityRegistry || buildCapabilityRegistry();
  const body = await readJsonBody(req);
  const nowMs = Date.now();
  const result = route.endsWith('/rank')
    ? rankEconomicOpportunities(body.opportunities, { capabilities: capabilityRegistry, nowMs })
    : scoreEconomicOpportunity(body.opportunity, { capabilities: capabilityRegistry, nowMs });
  sendJson(res, 200, result);
  return true;
}
