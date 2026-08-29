import { QUALIFICATION_PROFILES } from './orchestration-profiles.js';
import { getRuntimeCapabilityMap } from './capability-registry.js';

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function qualifyCandidate(candidate = {}, profileName = 'programmable_money_flow_v1') {
  const profile = QUALIFICATION_PROFILES[profileName];
  if (!profile) throw new Error(`unknown qualification profile: ${profileName}`);

  const metrics = candidate.metrics || candidate.scores || {};
  let weighted = 0;
  let positiveWeight = 0;
  const components = {};

  for (const [key, weight] of Object.entries(profile.weights)) {
    const value = clamp01(metrics[key]);
    components[key] = value;
    weighted += value * weight;
    if (weight > 0) positiveWeight += weight;
  }

  const normalized = positiveWeight > 0 ? Math.max(0, Math.min(10, (weighted / positiveWeight) * 10)) : 0;
  const hardGateFailures = profile.hardGates.filter(key => clamp01(metrics[key]) < 0.5);
  
  // Capabilities check
  const capabilities = getRuntimeCapabilityMap();
  const required = Array.isArray(candidate.requiredCapabilities) ? candidate.requiredCapabilities : [];
  const missingCaps = required.filter(key => !capabilities[key]);

  const passes = normalized >= profile.threshold && hardGateFailures.length === 0;
  const evidenceList = Array.isArray(candidate.evidence) ? candidate.evidence : [];
  const hasEvidence = evidenceList.length > 0 || Boolean(candidate.gateEvidence && Object.keys(candidate.gateEvidence).length > 0);

  let recommendedStatus = 'REJECTED';
  if (passes) {
    recommendedStatus = missingCaps.length === 0 ? 'EXECUTABLE' : 'SETUP_CANDIDATE';
  } else if (hardGateFailures.length === 0 && normalized >= 5.0) {
    recommendedStatus = 'WATCH';
  }

  return {
    profile: profileName,
    score: Number(normalized.toFixed(2)),
    threshold: profile.threshold,
    passes,
    hardGateFailures,
    components,
    missingCapabilities: missingCaps,
    hasEvidence,
    recommendedStatus
  };
}

export function normalizeCandidate(input = {}) {
  const sourceType = input.sourceType || input.source_type || 'unknown';
  const noveltyKey = input.noveltyKey || input.novelty_key || input.id || null;
  return {
    candidateId: input.candidateId || input.id || crypto.randomUUID(),
    sourceType,
    profile: input.profile || null,
    noveltyKey,
    title: input.title || input.name || 'Untitled candidate',
    moneyFlow: input.moneyFlow || input.money_flow || null,
    trigger: input.trigger || null,
    estimatedValue: input.estimatedValue ?? input.estimated_value ?? null,
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    gateEvidence: input.gateEvidence || {},
    sourceTimestamp: input.sourceTimestamp || input.source_timestamp || null,
    confidence: clamp01(input.confidence),
    metrics: input.metrics || input.scores || {},
    requiredCapabilities: Array.isArray(input.requiredCapabilities) ? input.requiredCapabilities : [],
    nextValidation: input.nextValidation || input.next_validation || null,
    raw: input.raw || null
  };
}

export function missingCapabilities(candidate, capabilities = {}) {
  const required = Array.isArray(candidate.requiredCapabilities) ? candidate.requiredCapabilities : [];
  return required.filter(key => !capabilities[key]);
}
