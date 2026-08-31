import { evaluateRequiredCapabilities } from './capability-registry.js';
import { QUALIFICATION_PROFILES } from './orchestration-profiles.js';

const VERDICTS = new Set(['pass', 'fail', 'uncertain']);

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function evidenceReferences(candidate = {}) {
  return (Array.isArray(candidate.evidence) ? candidate.evidence : [])
    .map(item => typeof item === 'string' ? item : item?.url || item?.ref || item?.evidenceRef)
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim());
}

function evidenceDecision(candidate, profile) {
  const references = evidenceReferences(candidate);
  const referenceSet = new Set(references);
  const supplied = candidate.gateEvidence && typeof candidate.gateEvidence === 'object'
    ? candidate.gateEvidence
    : {};
  const gateResults = {};
  const failed = [];
  const missing = [];

  for (const gate of profile.evidenceGates || []) {
    const descriptor = supplied[gate];
    const verdict = String(descriptor?.verdict || '').toLowerCase();
    const evidenceRef = typeof descriptor?.evidenceRef === 'string'
      ? descriptor.evidenceRef.trim()
      : '';
    const bound = evidenceRef && referenceSet.has(evidenceRef);
    const stale = descriptor?.stale === true || descriptor?.fresh === false;

    if (verdict === 'fail') {
      failed.push(gate);
      gateResults[gate] = { verdict: 'fail', evidenceRef: evidenceRef || null, bound, stale };
    } else if (verdict === 'pass' && bound && !stale) {
      gateResults[gate] = { verdict: 'pass', evidenceRef, bound: true, stale: false };
    } else {
      missing.push(gate);
      gateResults[gate] = {
        verdict: stale ? 'stale' : (VERDICTS.has(verdict) ? verdict : 'missing'),
        evidenceRef: evidenceRef || null,
        bound: Boolean(bound),
        stale
      };
    }
  }

  if (references.length === 0) {
    return {
      passed: false,
      status: 'NEEDS_EVIDENCE',
      reason: 'No verifiable evidence attached to candidate',
      references,
      gateResults,
      failedGates: failed,
      missingGates: profile.evidenceGates || []
    };
  }
  if (failed.length > 0) {
    return {
      passed: false,
      status: 'REJECTED',
      reason: `Evidence failed required gates: ${failed.join(', ')}`,
      references,
      gateResults,
      failedGates: failed,
      missingGates: missing
    };
  }
  if (missing.length > 0) {
    return {
      passed: false,
      status: 'NEEDS_EVIDENCE',
      reason: `Missing evidence-bound gateEvidence decisions: ${missing.join(', ')}`,
      references,
      gateResults,
      failedGates: [],
      missingGates: missing
    };
  }
  return {
    passed: true,
    status: profile.passStatus,
    reason: `All ${profile.evidenceGates.length} ${profile.passStatus === 'EXECUTABLE' ? 'execution' : 'money-flow'} gates passed with bound evidence`,
    references,
    gateResults,
    failedGates: [],
    missingGates: []
  };
}

function capabilityDecision(requiredCapabilities, capabilityOptions) {
  const result = evaluateRequiredCapabilities(requiredCapabilities, capabilityOptions);
  let setupState = 'READY';
  if (result.unavailable.length > 0 || result.unhealthy.length > 0) setupState = 'BLOCKED';
  else if (result.setupRequired.length > 0) setupState = 'SETUP_REQUIRED';
  return { ...result, setupState };
}

export function qualifyCandidate(candidate = {}, profileName = 'programmable_money_flow_v1', options = {}) {
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

  const score = positiveWeight > 0
    ? Math.max(0, Math.min(10, (weighted / positiveWeight) * 10))
    : 0;
  const hardGateFailures = profile.hardGates.filter(key => clamp01(metrics[key]) < 0.5);
  const scorePasses = score >= profile.threshold && hardGateFailures.length === 0;
  const evidence = evidenceDecision(candidate, profile);
  const requiredCapabilities = Array.isArray(candidate.requiredCapabilities)
    ? [...new Set(candidate.requiredCapabilities.filter(value => typeof value === 'string' && value))]
    : [];
  const capabilities = capabilityDecision(requiredCapabilities, options.capabilityOptions || {});

  let recommendedStatus = 'REJECTED';
  const reasons = [];
  if (hardGateFailures.length > 0) reasons.push(`Hard metrics failed: ${hardGateFailures.join(', ')}`);
  if (score < profile.threshold) reasons.push(`Score ${score.toFixed(2)} is below threshold ${profile.threshold}`);
  if (!evidence.passed) reasons.push(evidence.reason);

  if (scorePasses && evidence.passed) {
    if (capabilities.setupState === 'BLOCKED') {
      recommendedStatus = 'BLOCKED';
      reasons.push('One or more required capabilities are unavailable or unhealthy');
    } else if (capabilities.setupState === 'SETUP_REQUIRED') {
      recommendedStatus = 'SETUP_REQUIRED';
      reasons.push('One or more required capabilities need one-time setup');
    } else {
      recommendedStatus = profile.passStatus;
      reasons.push(evidence.reason);
    }
  } else if (hardGateFailures.length === 0 && score >= 5 && evidence.status !== 'REJECTED') {
    recommendedStatus = 'NEEDS_EVIDENCE';
  }

  return {
    profile: profileName,
    score: Number(score.toFixed(2)),
    threshold: profile.threshold,
    passes: scorePasses && evidence.passed && capabilities.setupState === 'READY',
    eligibleForValidation: scorePasses && evidence.status !== 'REJECTED',
    recommendedStatus,
    reasons,
    hardGateFailures,
    components,
    requiredCapabilities,
    setupState: capabilities.setupState,
    capabilities,
    evidence
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
    gateEvidence: input.gateEvidence && typeof input.gateEvidence === 'object' ? input.gateEvidence : {},
    sourceTimestamp: input.sourceTimestamp || input.source_timestamp || null,
    confidence: clamp01(input.confidence),
    metrics: input.metrics || input.scores || {},
    requiredCapabilities: Array.isArray(input.requiredCapabilities) ? input.requiredCapabilities : [],
    nextValidation: input.nextValidation || input.next_validation || null,
    acceptanceCriteria: input.acceptanceCriteria || input.acceptance_criteria || null,
    raw: input.raw || null
  };
}

export function missingCapabilities(candidate, capabilities = {}) {
  const required = Array.isArray(candidate.requiredCapabilities) ? candidate.requiredCapabilities : [];
  return required.filter(key => !capabilities[key]);
}

export function evaluateQualificationEvidence(candidate = {}, profileName = candidate.profile || 'programmable_money_flow_v1') {
  const profile = QUALIFICATION_PROFILES[profileName];
  if (!profile) {
    return {
      passed: false,
      status: 'NEEDS_EVIDENCE',
      reason: `Unknown profile ${profileName} requires evidence validation`,
      references: evidenceReferences(candidate),
      gateResults: {},
      failedGates: [],
      missingGates: []
    };
  }
  return evidenceDecision(candidate, profile);
}
