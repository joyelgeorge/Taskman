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

  // ── Source credibility & corroboration adjustment (added 2026-09-05) ──────
  //
  // Different signal origins have different signal-to-noise ratios. A Reuters
  // article corroborated by three independent sources is not the same as a
  // single Reddit post. We apply two multiplicative adjustments to the raw EV
  // before comparing against the threshold:
  //
  //   1. sourceWeight  — prior credibility of the feed (0.5-1.5, see sources.js)
  //   2. corroborationBonus — how many independent sources fired on the same
  //      signal recently. Each additional corroborating source adds +10% EV,
  //      capped at +50% (i.e. 5+ independent sources = maximum bonus).
  //
  // This does NOT change the 7-level economic taxonomy fields or the underlying
  // probability chain — it only adjusts the *adjusted EV* used for threshold
  // comparison, and is surfaced in the return value for transparency.
  const sourceWeight = finiteNumber(opportunity.sourceWeight, { min: 0.1, max: 2.0, fallback: 1.0 });
  const corroborationCount = Math.min(5, Math.max(0, Number(opportunity.corroborationCount) || 1));
  const corroborationBonus = 1 + 0.1 * (corroborationCount - 1); // 1.0 at count=1, 1.4 at count=5
  const adjustedEv = Number((ev.expectedNetValue * sourceWeight * corroborationBonus).toFixed(2));

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
  } else if (adjustedEv < minExpectedNetValue) {
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
    sourceWeight,
    corroborationCount,
    corroborationBonus: Number(corroborationBonus.toFixed(2)),
    adjustedEv,
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
      || b.adjustedEv - a.adjustedEv
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

/**
 * Bundles micro-value opportunities into aggregate execution plans.
 *
 * The core insight (from the MMM strategy): even the smallest amount executed
 * across multiple transactions compounds into large sums. A single $5 task
 * has too high an overhead ratio; 20 × $5 tasks executed as a batch share
 * overhead costs and become economically attractive.
 *
 * A "micro" opportunity is one whose grossReward is below `microThresholdCents`.
 * This function separates the opportunity set into macro and micro buckets,
 * then groups the micro opportunities by rail into bundles. Each bundle is
 * returned as a synthetic aggregate opportunity whose reward = sum of parts
 * and whose sourceWeight = mean sourceWeight of its constituent signals.
 *
 * Bundles smaller than `minBundleSize` are returned as individual micro items
 * (not bundled) so nothing is silently dropped.
 */
export function bundleMicroOpportunities(opportunities = [], {
  microThresholdCents = 1000,  // $10 or below = micro
  minBundleSize = 3
} = {}) {
  if (!Array.isArray(opportunities)) return { macro: [], bundles: [], unbundledMicro: [] };

  const macro = [];
  const microByRail = new Map();

  for (const opp of opportunities) {
    const reward = money(opp.reward);
    if (reward >= microThresholdCents) {
      macro.push(opp);
    } else {
      const rail = String(opp.rail || 'generic');
      if (!microByRail.has(rail)) microByRail.set(rail, []);
      microByRail.get(rail).push(opp);
    }
  }

  const bundles = [];
  const unbundledMicro = [];

  for (const [rail, items] of microByRail) {
    if (items.length >= minBundleSize) {
      const totalReward = items.reduce((s, o) => s + money(o.reward), 0);
      const avgSourceWeight = items.reduce((s, o) => s + finiteNumber(o.sourceWeight, { fallback: 1.0 }), 0) / items.length;
      bundles.push({
        id: `bundle-${rail}-${items.length}`,
        rail,
        title: `Bundle: ${items.length} micro-tasks on ${rail} rail`,
        reward: totalReward,
        sourceWeight: Number(avgSourceWeight.toFixed(2)),
        corroborationCount: items.length,
        bundleSize: items.length,
        constituentIds: items.map(o => o.id || o.candidateId).filter(Boolean),
        // Inherit evidence fields from the first item in the bundle
        ...Object.fromEntries(
          ['pEligible', 'pClaim', 'pAccept', 'pPayout', 'workerShare', 'aiCost',
           'platformFee', 'riskReserve', 'observedAt', 'probabilityEvidence',
           'requiredCapabilities'].map(k => [k, items[0][k]])
        ),
        isMicroBundle: true
      });
    } else {
      unbundledMicro.push(...items);
    }
  }

  return { macro, bundles, unbundledMicro };
}
