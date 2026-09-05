import { databaseEnabled, query, truncateForTesting } from '@taskman/db';
import { nowIso } from '../memory-table.js';

// In-memory fallback: Map from sourceKey -> { sourceKey, alpha, beta }
const mem = new Map();

const DEFAULT_ALPHA = 8;
const DEFAULT_BETA  = 2;

function weightFrom(alpha, beta) {
  return alpha / (alpha + beta);
}

function normalize(row = {}) {
  const alpha = Number(row.alpha ?? DEFAULT_ALPHA);
  const beta  = Number(row.beta  ?? DEFAULT_BETA);
  return {
    sourceKey: row.sourceKey ?? row.source_key,
    alpha,
    beta,
    weight: weightFrom(alpha, beta)
  };
}

/**
 * Records a WIN or LOSS outcome for a source, updating its Bayesian weights.
 * WIN  => alpha++
 * LOSS => beta++
 */
export async function recordSourceOutcome(sourceKey, outcome) {
  if (outcome !== 'win' && outcome !== 'loss') {
    throw new Error(`Invalid outcome: ${outcome}. Must be 'win' or 'loss'.`);
  }

  if (!databaseEnabled) {
    const existing = mem.get(sourceKey) ?? { sourceKey, alpha: DEFAULT_ALPHA, beta: DEFAULT_BETA };
    if (outcome === 'win') existing.alpha += 1;
    else                   existing.beta  += 1;
    mem.set(sourceKey, existing);
    return normalize(existing);
  }

  const alphaInc = outcome === 'win' ? 1 : 0;
  const betaInc  = outcome === 'loss' ? 1 : 0;

  const result = await query(`
    INSERT INTO source_weight_updates(source_key, alpha, beta, updated_at)
    VALUES($1, $2, $3, $4)
    ON CONFLICT (source_key) DO UPDATE SET
      alpha      = source_weight_updates.alpha + $5,
      beta       = source_weight_updates.beta  + $6,
      updated_at = $4
    RETURNING *
  `, [sourceKey, DEFAULT_ALPHA + alphaInc, DEFAULT_BETA + betaInc, nowIso(), alphaInc, betaInc]);

  return normalize(result.rows[0]);
}

/**
 * Returns the current weight info for a source.
 * Unknown sources return the default prior: alpha=8, beta=2, weight=0.8.
 */
export async function getSourceWeight(sourceKey) {
  if (!databaseEnabled) {
    const existing = mem.get(sourceKey);
    if (!existing) {
      return { sourceKey, alpha: DEFAULT_ALPHA, beta: DEFAULT_BETA, weight: weightFrom(DEFAULT_ALPHA, DEFAULT_BETA) };
    }
    return normalize(existing);
  }

  const result = await query(
    'SELECT * FROM source_weight_updates WHERE source_key = $1',
    [sourceKey]
  );

  if (!result.rows[0]) {
    return { sourceKey, alpha: DEFAULT_ALPHA, beta: DEFAULT_BETA, weight: weightFrom(DEFAULT_ALPHA, DEFAULT_BETA) };
  }
  return normalize(result.rows[0]);
}

/**
 * Lists all tracked source weights.
 */
export async function listSourceWeights() {
  if (!databaseEnabled) {
    return [...mem.values()].map(normalize);
  }
  const result = await query('SELECT * FROM source_weight_updates ORDER BY source_key ASC');
  return result.rows.map(normalize);
}

/**
 * Resets in-memory state (and truncates the DB table in test mode).
 */
export async function resetSourceWeightMemory() {
  mem.clear();
  await truncateForTesting(['source_weight_updates']);
}
