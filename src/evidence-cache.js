import { databaseEnabled, query } from './db.js';

const cacheMemoryStore = new Map(); // claimKey -> record

export const FRESHNESS_CLASS = Object.freeze({
  IMMUTABLE: 'IMMUTABLE',           // Historical facts, git commit hashes, fixed events (TTL: 365 days)
  SLOW_CHANGING: 'SLOW_CHANGING',   // Repo configuration, static schemas (TTL: 7 days)
  DAILY_CHANGING: 'DAILY_CHANGING', // Daily prices, aggregate issue counts (TTL: 24 hours)
  LIVE_STATE: 'LIVE_STATE',         // PR status, CI status, active issue comments (TTL: 15 minutes)
  EXECUTION_CRITICAL: 'EXECUTION_CRITICAL' // Bank balances, authorized payments, spend caps (TTL: 0, must recheck)
});

export const CACHE_STATUS = Object.freeze({
  VALID: 'VALID',
  CONTRADICTED: 'CONTRADICTED',
  STALE: 'STALE'
});

const TTL_MS = {
  [FRESHNESS_CLASS.IMMUTABLE]: 365 * 24 * 60 * 60 * 1000,
  [FRESHNESS_CLASS.SLOW_CHANGING]: 7 * 24 * 60 * 60 * 1000,
  [FRESHNESS_CLASS.DAILY_CHANGING]: 24 * 60 * 60 * 1000,
  [FRESHNESS_CLASS.LIVE_STATE]: 15 * 60 * 1000,
  [FRESHNESS_CLASS.EXECUTION_CRITICAL]: 0
};

/**
 * Computes expiration timestamp based on freshness class.
 */
export function calculateExpiration(freshnessClass, baseDate = new Date()) {
  const ttl = TTL_MS[freshnessClass] ?? TTL_MS[FRESHNESS_CLASS.LIVE_STATE];
  return new Date(baseDate.getTime() + ttl);
}

/**
 * Gets a cached evidence fact if it exists and satisfies freshness & schema criteria.
 */
export async function getCachedEvidence({
  claimKey,
  requiredFreshness = FRESHNESS_CLASS.LIVE_STATE,
  currentSchemaRevision = '1',
  now = new Date()
}) {
  if (!claimKey) return null;

  // Invariant 6: Execution-critical state must ALWAYS be refreshed immediately before irreversible action
  if (requiredFreshness === FRESHNESS_CLASS.EXECUTION_CRITICAL) {
    return null;
  }

  const currentTime = new Date(now);

  if (!databaseEnabled) {
    const record = cacheMemoryStore.get(claimKey);
    if (!record || record.status !== CACHE_STATUS.VALID) return null;

    // Check schema revision
    if (record.schemaRevision !== currentSchemaRevision) return null;

    // Check expiration
    if (record.expiresAt && new Date(record.expiresAt).getTime() <= currentTime.getTime()) {
      record.status = CACHE_STATUS.STALE;
      return null;
    }

    record.reuseCount++;
    record.lastUsedAt = currentTime.toISOString();
    return { ...record };
  }

  const res = await query(`
    SELECT * FROM evidence_cache_entries
    WHERE claim_key = $1
      AND status = 'VALID'
      AND schema_revision = $2
      AND (expires_at IS NULL OR expires_at > $3)
  `, [claimKey, currentSchemaRevision, currentTime.toISOString()]);

  if (!res.rows[0]) return null;

  const row = res.rows[0];

  // Increment reuse count
  await query(`
    UPDATE evidence_cache_entries
    SET reuse_count = reuse_count + 1,
        last_used_at = $2
    WHERE claim_key = $1
  `, [claimKey, currentTime.toISOString()]);

  return {
    claimKey: row.claim_key,
    normalizedStatement: row.normalized_statement,
    data: row.data,
    sourceRefs: row.source_refs,
    confidence: row.confidence,
    freshnessClass: row.freshness_class,
    schemaRevision: row.schema_revision,
    status: row.status,
    retrievedAt: row.retrieved_at,
    expiresAt: row.expires_at,
    lastUsedAt: currentTime.toISOString(),
    reuseCount: row.reuse_count + 1,
    estimatedTokensSaved: row.estimated_tokens_saved
  };
}

/**
 * Sets a cached evidence record with automatic TTL and token savings tracking.
 */
export async function setCachedEvidence({
  claimKey,
  normalizedStatement,
  data = {},
  sourceRefs = [],
  confidence = 1.0,
  freshnessClass = FRESHNESS_CLASS.LIVE_STATE,
  schemaRevision = '1',
  estimatedTokensSaved = 100,
  now = new Date()
}) {
  if (!claimKey || !normalizedStatement) throw new Error('claimKey and normalizedStatement are required');

  const currentTime = new Date(now);
  const expiresAt = calculateExpiration(freshnessClass, currentTime);

  const record = {
    claimKey,
    normalizedStatement,
    data,
    sourceRefs,
    confidence,
    freshnessClass,
    schemaRevision,
    status: CACHE_STATUS.VALID,
    retrievedAt: currentTime.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastUsedAt: currentTime.toISOString(),
    reuseCount: 0,
    estimatedTokensSaved
  };

  if (!databaseEnabled) {
    cacheMemoryStore.set(claimKey, { ...record });
    return record;
  }

  await query(`
    INSERT INTO evidence_cache_entries (
      claim_key, normalized_statement, data, source_refs, confidence,
      freshness_class, schema_revision, status, retrieved_at, expires_at,
      last_used_at, reuse_count, estimated_tokens_saved
    )
    VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (claim_key) DO UPDATE SET
      normalized_statement = EXCLUDED.normalized_statement,
      data = EXCLUDED.data,
      source_refs = EXCLUDED.source_refs,
      confidence = EXCLUDED.confidence,
      freshness_class = EXCLUDED.freshness_class,
      schema_revision = EXCLUDED.schema_revision,
      status = 'VALID',
      retrieved_at = EXCLUDED.retrieved_at,
      expires_at = EXCLUDED.expires_at,
      last_used_at = EXCLUDED.last_used_at
  `, [
    record.claimKey,
    record.normalizedStatement,
    JSON.stringify(record.data),
    JSON.stringify(record.sourceRefs),
    record.confidence,
    record.freshnessClass,
    record.schemaRevision,
    record.status,
    record.retrievedAt,
    record.expiresAt,
    record.lastUsedAt,
    record.reuseCount,
    record.estimatedTokensSaved
  ]);

  return record;
}

/**
 * Invalidates a cached fact due to contradiction or manual invalidation.
 */
export async function invalidateCachedEvidence({ claimKey, reason = 'Contradiction detected' }) {
  if (!databaseEnabled) {
    const record = cacheMemoryStore.get(claimKey);
    if (record) {
      record.status = CACHE_STATUS.CONTRADICTED;
      record.reason = reason;
      return true;
    }
    return false;
  }

  const res = await query(`
    UPDATE evidence_cache_entries
    SET status = 'CONTRADICTED'
    WHERE claim_key = $1
  `, [claimKey]);
  return res.rowCount > 0;
}

export function resetEvidenceCacheMemory() {
  cacheMemoryStore.clear();
}
