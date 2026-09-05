import crypto from 'node:crypto';
import { databaseEnabled, query, truncateForTesting } from './db.js';

const manifestMemoryStore = new Map(); // id -> manifest

export const CONTEXT_PRIORITY = Object.freeze({
  MANDATORY_POLICY: 1000,
  CANDIDATE_FACTS: 800,
  FRESH_EVIDENCE: 600,
  PRIOR_DECISIONS: 400,
  LEARNING_INFERENCE: 200,
  BACKGROUND: 100
});

/**
 * Estimates token count from string (conservative approximation: ~4 chars per token).
 */
export function estimateTokens(obj) {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj || '');
  return Math.ceil(str.length / 4);
}

/**
 * Computes deterministic SHA-256 digest of compiled items.
 */
export function computeContextDigest(items) {
  const normalized = items.map(i => ({
    category: i.category,
    sourceId: i.sourceId,
    content: i.content
  }));
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Relevance-first Context Compiler.
 * Assembles minimal high-signal context pack, strictly prioritizing mandatory policy & candidate facts.
 */
export async function compileContextPack({
  stage = 'DISCOVER',
  candidate = null,
  profile = null,
  maxBudgetTokens = 4000,
  mandatoryPolicy = {},
  candidateEvidence = [],
  priorDecisions = [],
  learningInferences = [],
  backgroundKnowledge = []
} = {}) {
  const items = [];

  // Priority 1: Mandatory Invariants & Policy (CANNOT be dropped)
  items.push({
    priority: CONTEXT_PRIORITY.MANDATORY_POLICY,
    category: 'MANDATORY_POLICY',
    sourceId: 'system_policy',
    mandatory: true,
    content: {
      stage,
      profile: profile || candidate?.profile || 'standard',
      deterministicGating: true,
      economicTruthRequired: true,
      ...mandatoryPolicy
    }
  });

  // Priority 2: Current Candidate / Task Facts (CANNOT be dropped if candidate present)
  if (candidate) {
    items.push({
      priority: CONTEXT_PRIORITY.CANDIDATE_FACTS,
      category: 'CANDIDATE_FACTS',
      sourceId: candidate.candidateId || candidate.id || 'candidate_input',
      mandatory: true,
      content: {
        id: candidate.candidateId || candidate.id,
        title: candidate.title,
        acceptanceCriteria: candidate.acceptanceCriteria,
        noveltyKey: candidate.noveltyKey,
        requiredCapabilities: candidate.requiredCapabilities || [],
        sourceType: candidate.sourceType || 'unknown',
        createdAt: candidate.createdAt
      }
    });
  }

  // Priority 3: Fresh Relevant Evidence
  const candidateNoveltyKey = candidate?.noveltyKey || candidate?.id;
  for (const ev of candidateEvidence) {
    // Only include evidence matching candidate or relevant domain
    const matchesCandidate = !candidateNoveltyKey || ev.candidateId === candidateNoveltyKey || (ev.evidenceRefs && ev.evidenceRefs.includes(candidateNoveltyKey));
    if (matchesCandidate || ev.relevant) {
      items.push({
        priority: CONTEXT_PRIORITY.FRESH_EVIDENCE,
        category: 'FRESH_EVIDENCE',
        sourceId: ev.id || ev.ref || 'evidence_source',
        mandatory: false,
        timestamp: ev.timestamp || ev.createdAt,
        content: ev.data || ev
      });
    }
  }

  // Priority 4: Relevant Prior Decisions
  for (const dec of priorDecisions) {
    const isRelevant = !candidateNoveltyKey || dec.candidateKey === candidateNoveltyKey || dec.profile === profile;
    if (isRelevant) {
      items.push({
        priority: CONTEXT_PRIORITY.PRIOR_DECISIONS,
        category: 'PRIOR_DECISIONS',
        sourceId: dec.id || 'decision_source',
        mandatory: false,
        content: {
          decision: dec.decision || dec.status,
          reason: dec.reason,
          timestamp: dec.timestamp
        }
      });
    }
  }

  // Priority 5: High-Confidence Learning Inferences
  for (const lr of learningInferences) {
    if (lr.confidence >= 0.5) {
      const scopeMatch = !lr.scope || !candidateNoveltyKey || lr.scope.includes(candidateNoveltyKey) || lr.scope === 'global';
      if (scopeMatch) {
        items.push({
          priority: CONTEXT_PRIORITY.LEARNING_INFERENCE,
          category: 'LEARNING_INFERENCE',
          sourceId: lr.id || 'learning_source',
          mandatory: false,
          confidence: lr.confidence,
          content: {
            statement: lr.statement,
            classification: lr.classification,
            confidence: lr.confidence
          }
        });
      }
    }
  }

  // Priority 6: Optional Background Knowledge (only directly relevant)
  for (const bg of backgroundKnowledge) {
    if (bg.relevant) {
      items.push({
        priority: CONTEXT_PRIORITY.BACKGROUND,
        category: 'BACKGROUND',
        sourceId: bg.id || 'background_source',
        mandatory: false,
        content: bg.content || bg
      });
    }
  }

  // Rank items by priority descending
  items.sort((a, b) => b.priority - a.priority);

  // Budget packing: include items until maxBudgetTokens is reached, never dropping mandatory items
  const included = [];
  let currentTokens = 0;
  let droppedCount = 0;

  for (const item of items) {
    const tokens = estimateTokens(item.content);
    if (item.mandatory || currentTokens + tokens <= maxBudgetTokens) {
      included.push(item);
      currentTokens += tokens;
    } else {
      droppedCount++;
    }
  }

  const digestSha256 = computeContextDigest(included);
  const manifest = {
    id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    callerStage: stage,
    candidateId: candidate?.candidateId || candidate?.id || null,
    digestSha256,
    itemCount: included.length,
    estimatedTokens: currentTokens,
    manifestSummary: {
      categories: included.map(i => i.category),
      sources: included.map(i => i.sourceId),
      droppedCount
    },
    createdAt: new Date().toISOString()
  };

  await saveContextManifest(manifest);

  return {
    contextPack: included.map(i => ({
      category: i.category,
      sourceId: i.sourceId,
      mandatory: i.mandatory || false,
      content: i.content
    })),
    manifest
  };
}

export async function saveContextManifest(manifest) {
  if (!databaseEnabled) {
    manifestMemoryStore.set(manifest.id, { ...manifest });
    return manifest;
  }

  await query(`
    INSERT INTO compiled_context_manifests (
      id, caller_stage, candidate_id, digest_sha256, item_count,
      estimated_tokens, manifest_summary, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    ON CONFLICT (id) DO NOTHING
  `, [
    manifest.id,
    manifest.callerStage,
    manifest.candidateId,
    manifest.digestSha256,
    manifest.itemCount,
    manifest.estimatedTokens,
    JSON.stringify(manifest.manifestSummary),
    manifest.createdAt
  ]);

  return manifest;
}

export async function listContextManifests({ stage, limit = 50 } = {}) {
  if (!databaseEnabled) {
    let list = Array.from(manifestMemoryStore.values());
    if (stage) list = list.filter(m => m.callerStage === stage);
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
  }

  let sql = 'SELECT * FROM compiled_context_manifests';
  const params = [];
  if (stage) {
    sql += ' WHERE caller_stage = $1';
    params.push(stage);
  }
  sql += ' ORDER BY created_at DESC LIMIT ' + limit;
  const res = await query(sql, params);
  return res.rows.map(r => ({
    id: r.id,
    callerStage: r.caller_stage,
    candidateId: r.candidate_id,
    digestSha256: r.digest_sha256,
    itemCount: r.item_count,
    estimatedTokens: r.estimated_tokens,
    manifestSummary: r.manifest_summary,
    createdAt: r.created_at
  }));
}

export async function resetContextCompilerMemory() {
  manifestMemoryStore.clear();
  await truncateForTesting(['compiled_context_manifests']);
}
