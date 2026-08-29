import { CANONICAL_QUEUES } from './orchestration-profiles.js';
import { upsertRevenueRecord, listRevenueRecords } from './revenue-store.js';

export const INFERENCE_CLASSIFICATION = Object.freeze({
  TEMPORARY_HINT: 'TEMPORARY_HINT',
  DURABLE_RULE: 'DURABLE_RULE'
});

export const GUIDANCE_EVALUATION = Object.freeze({
  USEFUL: 'useful',
  MISLEADING: 'misleading',
  INCONCLUSIVE: 'inconclusive'
});

/**
 * Creates or updates an evidence-backed learning inference record.
 */
export async function recordLearningInference({
  statement,
  classification = INFERENCE_CLASSIFICATION.TEMPORARY_HINT,
  confidence = 0.5,
  evidenceCount = 1,
  supportingEvidence = [],
  sourceWorker = 'discover',
  expiresAt = null,
  weightAdjustment = null,
  noveltyKey = null
}) {
  if (!statement || typeof statement !== 'string') {
    throw new Error('statement is required');
  }

  // Durable rules require high confidence (>= 0.8) and multiple evidence points (>= 2)
  let resolvedClassification = classification;
  if (classification === INFERENCE_CLASSIFICATION.DURABLE_RULE) {
    if (confidence < 0.8 || evidenceCount < 2 || supportingEvidence.length === 0) {
      resolvedClassification = INFERENCE_CLASSIFICATION.TEMPORARY_HINT;
    }
  }

  const key = noveltyKey || `learning-${statement.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}`;

  const payload = {
    statement,
    classification: resolvedClassification,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0.5)),
    evidenceCount: Number(evidenceCount) || 1,
    supportingEvidence: Array.isArray(supportingEvidence) ? supportingEvidence : [],
    sourceWorker,
    createdAt: new Date().toISOString(),
    expiresAt,
    weightAdjustment: weightAdjustment || null,
    statusHistory: [{ action: 'created', timestamp: new Date().toISOString() }]
  };

  return upsertRevenueRecord({
    queue: CANONICAL_QUEUES.inference,
    noveltyKey: key,
    status: 'ACTIVE',
    priority: resolvedClassification === INFERENCE_CLASSIFICATION.DURABLE_RULE ? 10 : 5,
    payload
  });
}

/**
 * Lists active learning inferences.
 */
export async function listActiveInferences({ sourceWorker = null, limit = 50 } = {}) {
  const records = await listRevenueRecords(CANONICAL_QUEUES.inference, { status: 'ACTIVE', limit });
  return records
    .map(r => ({ id: r.id, noveltyKey: r.noveltyKey, ...r.payload }))
    .filter(inf => !sourceWorker || inf.sourceWorker === sourceWorker);
}

/**
 * Evaluates past guidance when new evidence arrives.
 */
export async function evaluatePastGuidance(noveltyKey, evaluation, feedbackEvidence = null) {
  const records = await listRevenueRecords(CANONICAL_QUEUES.inference, { limit: 100 });
  const target = records.find(r => r.noveltyKey === noveltyKey);
  if (!target) return null;

  const payload = { ...target.payload };
  payload.statusHistory = payload.statusHistory || [];
  payload.statusHistory.push({
    action: 'evaluated',
    evaluation,
    feedbackEvidence,
    timestamp: new Date().toISOString()
  });

  if (evaluation === GUIDANCE_EVALUATION.MISLEADING) {
    // Downgrade durable rule or retire misleading inference
    payload.classification = INFERENCE_CLASSIFICATION.TEMPORARY_HINT;
    payload.confidence = Math.max(0.1, (payload.confidence || 0.5) - 0.3);
    if (payload.confidence <= 0.2) {
      return upsertRevenueRecord({
        ...target,
        status: 'RETIRED',
        payload
      });
    }
  } else if (evaluation === GUIDANCE_EVALUATION.USEFUL) {
    payload.evidenceCount = (payload.evidenceCount || 1) + 1;
    payload.confidence = Math.min(1.0, (payload.confidence || 0.5) + 0.1);
    if (payload.confidence >= 0.8 && payload.evidenceCount >= 2) {
      payload.classification = INFERENCE_CLASSIFICATION.DURABLE_RULE;
    }
  }

  return upsertRevenueRecord({
    ...target,
    priority: payload.classification === INFERENCE_CLASSIFICATION.DURABLE_RULE ? 10 : 5,
    payload
  });
}
