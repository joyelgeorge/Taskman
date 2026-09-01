import { createHash } from 'node:crypto';
import { CANONICAL_QUEUES } from './orchestration-profiles.js';
import {
  listRevenueRecords,
  updateRevenueRecord,
  upsertRevenueRecord
} from './revenue-store.js';

export const LEARNING_CLASSIFICATIONS = Object.freeze({
  TEMPORARY_HINT: 'TEMPORARY_HINT',
  DURABLE_RULE: 'DURABLE_RULE'
});

export const GUIDANCE_EVALUATIONS = Object.freeze({
  USEFUL: 'USEFUL',
  MISLEADING: 'MISLEADING',
  INCONCLUSIVE: 'INCONCLUSIVE'
});

const DURABLE_CONFIDENCE = 0.8;
const DURABLE_EVIDENCE = 3;
const DEFAULT_HINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function evidenceKey(value) {
  if (typeof value === 'string') return normalizeText(value);
  if (!value || typeof value !== 'object') return '';
  return normalizeText(value.ref || value.url || value.id || value.recordId || value.sha);
}

function normalizeEvidence(values = []) {
  const seen = new Set();
  const normalized = [];
  for (const value of Array.isArray(values) ? values : []) {
    const key = evidenceKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(typeof value === 'string' ? key : { ...value, ref: key });
  }
  return normalized;
}

function noveltyKeyFor({ scope = 'global', statement, sourceWorker = 'unknown' }) {
  const semantic = `${normalizeText(scope).toLowerCase()}|${normalizeText(sourceWorker).toLowerCase()}|${normalizeText(statement).toLowerCase()}`;
  return `learning-${createHash('sha256').update(semantic).digest('hex').slice(0, 24)}`;
}

function normalizeWeightAdjustment(value) {
  if (!value || typeof value !== 'object') return null;
  const targetType = value.targetType === 'candidate' ? 'candidate' : 'source';
  const target = normalizeText(value.target);
  if (!target) return null;
  return { targetType, target, delta: clamp(value.delta, -0.5, 0.5) };
}

function qualifiesAsDurable(payload) {
  return payload.confidence >= DURABLE_CONFIDENCE &&
    payload.supportingEvidence.length >= DURABLE_EVIDENCE &&
    payload.evidenceCount >= DURABLE_EVIDENCE;
}

export function normalizeLearningInference(input = {}, { now = new Date() } = {}) {
  const statement = normalizeText(input.statement);
  if (!statement) throw new Error('learning statement is required');
  const supportingEvidence = normalizeEvidence(input.supportingEvidence);
  const requested = input.classification === LEARNING_CLASSIFICATIONS.DURABLE_RULE
    ? LEARNING_CLASSIFICATIONS.DURABLE_RULE
    : LEARNING_CLASSIFICATIONS.TEMPORARY_HINT;
  const createdAt = input.createdAt || now.toISOString();
  const payload = {
    statement,
    classification: requested,
    confidence: clamp(input.confidence),
    evidenceCount: supportingEvidence.length,
    supportingEvidence,
    sourceWorker: normalizeText(input.sourceWorker) || 'unknown',
    createdAt,
    expiresAt: input.expiresAt || (requested === LEARNING_CLASSIFICATIONS.TEMPORARY_HINT
      ? new Date(now.getTime() + DEFAULT_HINT_TTL_MS).toISOString()
      : null),
    weightAdjustment: normalizeWeightAdjustment(input.weightAdjustment),
    scope: normalizeText(input.scope) || 'global',
    hardFilter: Boolean(input.hardFilter),
    mandatoryChecks: [...new Set((input.mandatoryChecks || []).map(normalizeText).filter(Boolean))],
    occurrences: Math.max(1, Number(input.occurrences) || 1),
    status: input.status === 'RETIRED' ? 'RETIRED' : 'ACTIVE',
    evaluationHistory: Array.isArray(input.evaluationHistory) ? input.evaluationHistory : []
  };
  if (payload.classification === LEARNING_CLASSIFICATIONS.DURABLE_RULE && !qualifiesAsDurable(payload)) {
    payload.classification = LEARNING_CLASSIFICATIONS.TEMPORARY_HINT;
    payload.hardFilter = false;
    payload.expiresAt ||= new Date(now.getTime() + DEFAULT_HINT_TTL_MS).toISOString();
  }
  if (payload.classification !== LEARNING_CLASSIFICATIONS.DURABLE_RULE) payload.hardFilter = false;
  return payload;
}

export async function recordLearningInference(input, { now = new Date() } = {}) {
  const normalized = normalizeLearningInference(input, { now });
  const noveltyKey = input.noveltyKey || noveltyKeyFor(normalized);
  const existing = (await listRevenueRecords(CANONICAL_QUEUES.inference, { limit: 500 }))
    .find(record => record.noveltyKey === noveltyKey);
  if (existing) {
    const prior = existing.payload || {};
    const evidence = normalizeEvidence([...(prior.supportingEvidence || []), ...normalized.supportingEvidence]);
    const merged = normalizeLearningInference({
      ...prior,
      ...normalized,
      classification: prior.classification === LEARNING_CLASSIFICATIONS.DURABLE_RULE || input.classification === LEARNING_CLASSIFICATIONS.DURABLE_RULE
        ? LEARNING_CLASSIFICATIONS.DURABLE_RULE
        : LEARNING_CLASSIFICATIONS.TEMPORARY_HINT,
      confidence: Math.max(Number(prior.confidence) || 0, Number(input.confidence) || 0),
      supportingEvidence: evidence,
      hardFilter: Boolean(prior.hardFilter || input.hardFilter),
      occurrences: (Number(prior.occurrences) || 1) + 1,
      createdAt: prior.createdAt || normalized.createdAt,
      evaluationHistory: prior.evaluationHistory || []
    }, { now });
    return updateRevenueRecord(existing.id, {
      status: merged.status,
      priority: Math.round(merged.confidence * 100),
      payload: merged
    });
  }
  return upsertRevenueRecord({
    queue: CANONICAL_QUEUES.inference,
    noveltyKey,
    status: normalized.status,
    priority: Math.round(normalized.confidence * 100),
    payload: normalized
  });
}

export async function listActiveLearning({ now = new Date(), scope } = {}) {
  const records = await listRevenueRecords(CANONICAL_QUEUES.inference, { limit: 500 });
  return records.filter(record => {
    const learning = record.payload || {};
    if (!learning.statement || learning.status === 'RETIRED' || record.status === 'RETIRED') return false;
    if (scope && learning.scope !== scope && learning.scope !== 'global') return false;
    return !learning.expiresAt || new Date(learning.expiresAt) > now;
  });
}

export function compileLearningGuidance(records = []) {
  const sourceWeights = {};
  const candidateWeights = {};
  const mandatoryChecks = new Set();
  const hardFilters = [];
  const appliedLearningIds = [];
  for (const record of records) {
    const learning = record.payload || record;
    if (!learning.statement || learning.status === 'RETIRED') continue;
    appliedLearningIds.push(record.id || learning.id || record.noveltyKey);
    const adjustment = normalizeWeightAdjustment(learning.weightAdjustment);
    if (adjustment) {
      const bucket = adjustment.targetType === 'candidate' ? candidateWeights : sourceWeights;
      bucket[adjustment.target] = clamp((bucket[adjustment.target] || 0) + adjustment.delta, -0.5, 0.5);
    }
    for (const check of learning.mandatoryChecks || []) mandatoryChecks.add(check);
    if (learning.classification === LEARNING_CLASSIFICATIONS.DURABLE_RULE &&
        learning.hardFilter && qualifiesAsDurable({
          ...learning,
          supportingEvidence: normalizeEvidence(learning.supportingEvidence)
        })) {
      hardFilters.push({ scope: learning.scope, statement: learning.statement, learningId: record.id });
    }
  }
  return { sourceWeights, candidateWeights, mandatoryChecks: [...mandatoryChecks], hardFilters, appliedLearningIds };
}

export function applyLearningToCandidates(candidates = [], guidance = {}, { minimumSourceDiversity = 2 } = {}) {
  const hardFiltered = [];
  const ranked = [];
  for (const candidate of candidates) {
    const source = candidate.sourceType || 'unknown';
    const blocked = (guidance.hardFilters || []).some(filter =>
      filter.scope === `source:${source}` || filter.scope === `candidate:${candidate.candidateId}`);
    if (blocked) {
      hardFiltered.push(candidate);
      continue;
    }
    const adjustment = (guidance.sourceWeights?.[source] || 0) +
      (guidance.candidateWeights?.[candidate.candidateId] || 0);
    ranked.push({ ...candidate, learningAdjustment: clamp(adjustment, -0.5, 0.5) });
  }
  ranked.sort((a, b) => b.learningAdjustment - a.learningAdjustment);
  const availableSources = new Set(ranked.map(candidate => candidate.sourceType || 'unknown'));
  const diversityFloor = Math.min(Math.max(1, minimumSourceDiversity), availableSources.size);
  const selectedSources = new Set(ranked.slice(0, Math.max(diversityFloor, 1)).map(c => c.sourceType || 'unknown'));
  if (selectedSources.size < diversityFloor) {
    for (let index = diversityFloor; index < ranked.length && selectedSources.size < diversityFloor; index += 1) {
      const source = ranked[index].sourceType || 'unknown';
      if (selectedSources.has(source)) continue;
      const swap = ranked.findIndex((candidate, i) => i < diversityFloor &&
        ranked.slice(0, diversityFloor).filter(c => (c.sourceType || 'unknown') === (candidate.sourceType || 'unknown')).length > 1);
      if (swap >= 0) [ranked[swap], ranked[index]] = [ranked[index], ranked[swap]];
      selectedSources.add(source);
    }
  }
  return { candidates: ranked, hardFiltered, diversityFloor };
}

export async function evaluatePastGuidance(recordId, evaluation, { evidenceRef, now = new Date() } = {}) {
  const record = (await listRevenueRecords(CANONICAL_QUEUES.inference, { limit: 500 }))
    .find(item => item.id === recordId || item.noveltyKey === recordId);
  if (!record) return null;
  const kind = Object.values(GUIDANCE_EVALUATIONS).includes(evaluation)
    ? evaluation
    : GUIDANCE_EVALUATIONS.INCONCLUSIVE;
  const prior = record.payload;
  const history = [...(prior.evaluationHistory || []), { evaluation: kind, evidenceRef: normalizeText(evidenceRef) || null, at: now.toISOString() }];
  const misleadingCount = history.filter(entry => entry.evaluation === GUIDANCE_EVALUATIONS.MISLEADING).length;
  const supportingEvidence = kind === GUIDANCE_EVALUATIONS.USEFUL && evidenceRef
    ? normalizeEvidence([...(prior.supportingEvidence || []), evidenceRef])
    : normalizeEvidence(prior.supportingEvidence);
  let confidence = Number(prior.confidence) || 0;
  if (kind === GUIDANCE_EVALUATIONS.USEFUL) confidence = clamp(confidence + 0.05);
  if (kind === GUIDANCE_EVALUATIONS.MISLEADING) confidence = clamp(confidence - 0.25);
  let classification = prior.classification;
  let status = prior.status || 'ACTIVE';
  if (kind === GUIDANCE_EVALUATIONS.MISLEADING && classification === LEARNING_CLASSIFICATIONS.DURABLE_RULE) {
    classification = LEARNING_CLASSIFICATIONS.TEMPORARY_HINT;
  }
  if (misleadingCount >= 2 || confidence < 0.25) status = 'RETIRED';
  const updated = normalizeLearningInference({
    ...prior,
    classification,
    confidence,
    supportingEvidence,
    hardFilter: status === 'ACTIVE' && classification === LEARNING_CLASSIFICATIONS.DURABLE_RULE && prior.hardFilter,
    status,
    evaluationHistory: history
  }, { now });
  return updateRevenueRecord(record.id, {
    status: updated.status,
    priority: Math.round(updated.confidence * 100),
    payload: updated
  });
}
