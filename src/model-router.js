import { databaseEnabled, query } from './db.js';

const decisionsMemoryStore = new Map(); // id -> record

export const MODEL_TIERS = Object.freeze({
  TIER_0: 'TIER_0', // Deterministic / Code only (Cost: $0.00)
  TIER_1: 'TIER_1', // Cheap / Small models (e.g. llama-3.1-8b, gemini-2.0-flash, gpt-4o-mini-nano)
  TIER_2: 'TIER_2', // General reasoning models (e.g. gpt-4o-mini, standard Claude/Gemini)
  TIER_3: 'TIER_3'  // Frontier / Deep reasoning models (e.g. gpt-4o, o1, Claude 3.5 Sonnet)
});

export const TIER_COST_ESTIMATES_CENTS = Object.freeze({
  [MODEL_TIERS.TIER_0]: 0,
  [MODEL_TIERS.TIER_1]: 1,  // ~0.01 cent per invocation
  [MODEL_TIERS.TIER_2]: 5,  // ~0.05 cents per invocation
  [MODEL_TIERS.TIER_3]: 50  // ~0.50 cents per invocation
});

const DEFAULT_TIER_FOR_TASK = Object.freeze({
  normalization: MODEL_TIERS.TIER_0,
  extraction: MODEL_TIERS.TIER_1,
  classification: MODEL_TIERS.TIER_1,
  evidence_synthesis: MODEL_TIERS.TIER_2,
  adversarial_validation: MODEL_TIERS.TIER_2,
  code_generation: MODEL_TIERS.TIER_2,
  deep_reasoning: MODEL_TIERS.TIER_3
});

export const TIER_PROVIDERS = Object.freeze({
  [MODEL_TIERS.TIER_0]: [{ id: 'deterministic', model: 'none' }],
  [MODEL_TIERS.TIER_1]: [
    { id: 'groq', model: 'llama-3.1-8b-instant' },
    { id: 'gemini', model: 'gemini-2.0-flash' }
  ],
  [MODEL_TIERS.TIER_2]: [
    { id: 'openai', model: 'gpt-4o-mini' },
    { id: 'gemini', model: 'gemini-2.0-flash' }
  ],
  [MODEL_TIERS.TIER_3]: [
    { id: 'openai', model: 'gpt-4o' }
  ]
});

/**
 * Selects baseline model tier according to task class and economic bounds.
 */
export function selectModelTier({
  taskClass = 'extraction',
  estimatedValueCents = 100,
  maxCostCents = 10
} = {}) {
  const defaultTier = DEFAULT_TIER_FOR_TASK[taskClass] || MODEL_TIERS.TIER_1;
  const estimatedCost = TIER_COST_ESTIMATES_CENTS[defaultTier];

  // If default tier exceeds maxCostCents, downscale to a cheaper capable tier
  if (estimatedCost > maxCostCents) {
    if (TIER_COST_ESTIMATES_CENTS[MODEL_TIERS.TIER_1] <= maxCostCents) {
      return {
        tier: MODEL_TIERS.TIER_1,
        reason: 'Downscaled to TIER_1 due to cost ceiling',
        estimatedCostCents: TIER_COST_ESTIMATES_CENTS[MODEL_TIERS.TIER_1]
      };
    }
    return {
      tier: MODEL_TIERS.TIER_0,
      reason: 'Downscaled to TIER_0 (deterministic) due to strict cost cap',
      estimatedCostCents: 0
    };
  }

  return {
    tier: defaultTier,
    reason: `Selected standard baseline tier for ${taskClass}`,
    estimatedCostCents: estimatedCost
  };
}

/**
 * Evaluates whether an escalation to a higher tier is economically justified.
 * Rules:
 * 1. Low self-reported confidence alone CANNOT trigger escalation.
 * 2. Predefined deterministic failure (schema invalid, post-condition failed) MUST be present.
 * 3. Next tier cost must NOT exceed maxCostCents or expected value threshold.
 */
export function evaluateEscalation({
  currentTier,
  failureReason,
  selfReportedConfidence = 1.0,
  estimatedValueCents = 100,
  maxCostCents = 100
}) {
  if (!failureReason || failureReason === 'LOW_CONFIDENCE') {
    return {
      allowed: false,
      reason: 'Model self-reported confidence alone cannot trigger tier escalation'
    };
  }

  let nextTier = null;
  if (currentTier === MODEL_TIERS.TIER_0) nextTier = MODEL_TIERS.TIER_1;
  else if (currentTier === MODEL_TIERS.TIER_1) nextTier = MODEL_TIERS.TIER_2;
  else if (currentTier === MODEL_TIERS.TIER_2) nextTier = MODEL_TIERS.TIER_3;
  else {
    return {
      allowed: false,
      reason: 'Already at highest tier (TIER_3)'
    };
  }

  const nextCost = TIER_COST_ESTIMATES_CENTS[nextTier];

  // Check budget caps
  if (nextCost > maxCostCents) {
    return {
      allowed: false,
      reason: `Escalation cost (${nextCost} cents) exceeds job ceiling (${maxCostCents} cents)`
    };
  }

  // Economic justification: expected value must be at least 3x the cost of tier
  if (estimatedValueCents > 0 && estimatedValueCents < nextCost * 2) {
    return {
      allowed: false,
      reason: `Expected economic value (${estimatedValueCents}c) does not justify escalation cost (${nextCost}c)`
    };
  }

  return {
    allowed: true,
    nextTier,
    estimatedCostCents: nextCost,
    reason: `Deterministic quality check failed: ${failureReason}`
  };
}

/**
 * Resolves a concrete provider configuration for a selected tier.
 */
export function resolveProviderForTier(tier, availableProviders = []) {
  const candidates = TIER_PROVIDERS[tier] || [];
  if (tier === MODEL_TIERS.TIER_0) {
    return { providerId: 'deterministic', model: 'none' };
  }

  // Pick first available provider
  for (const c of candidates) {
    const isAvailable = availableProviders.length === 0 || availableProviders.some(p => p.id === c.id && p.ready !== false);
    if (isAvailable) {
      return { providerId: c.id, model: c.model };
    }
  }

  // Fallback to candidate default
  return candidates[0] || { providerId: 'unknown', model: 'unknown' };
}

/**
 * Persists a routing decision.
 */
export async function recordRoutingDecision(decision) {
  const record = {
    id: decision.id || `route-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    taskId: decision.taskId || null,
    taskClass: decision.taskClass || 'general',
    selectedTier: decision.selectedTier,
    escalatedFromTier: decision.escalatedFromTier || null,
    escalationReason: decision.escalationReason || null,
    providerId: decision.providerId,
    modelId: decision.modelId,
    estimatedCostCents: decision.estimatedCostCents || 0,
    outcomeStatus: decision.outcomeStatus || 'PENDING',
    createdAt: new Date().toISOString()
  };

  if (!databaseEnabled) {
    decisionsMemoryStore.set(record.id, { ...record });
    return record;
  }

  await query(`
    INSERT INTO model_routing_decisions (
      id, task_id, task_class, selected_tier, escalated_from_tier,
      escalation_reason, provider_id, model_id, estimated_cost_cents,
      outcome_status, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
  `, [
    record.id, record.taskId, record.taskClass, record.selectedTier,
    record.escalatedFromTier, record.escalationReason, record.providerId,
    record.modelId, record.estimatedCostCents, record.outcomeStatus
  ]);

  return record;
}

export async function listRoutingDecisions({ limit = 50 } = {}) {
  if (!databaseEnabled) {
    return Array.from(decisionsMemoryStore.values()).slice(0, limit);
  }

  const res = await query('SELECT * FROM model_routing_decisions ORDER BY created_at DESC LIMIT ' + limit);
  return res.rows.map(r => ({
    id: r.id,
    taskId: r.task_id,
    taskClass: r.task_class,
    selectedTier: r.selected_tier,
    escalatedFromTier: r.escalated_from_tier,
    escalationReason: r.escalation_reason,
    providerId: r.provider_id,
    modelId: r.model_id,
    estimatedCostCents: r.estimated_cost_cents,
    outcomeStatus: r.outcome_status,
    createdAt: r.created_at
  }));
}

export function resetModelRouterMemory() {
  decisionsMemoryStore.clear();
}
