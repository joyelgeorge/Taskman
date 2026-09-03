import { collectSource } from './collector.js';
import {
  registerSource, listSources, dueSources, recordSourceRun,
  recordObservations, rollupDay, pruneRawObservations, storageStats
} from './store.js';
import { DEFAULT_SOURCES } from './sources.js';

/**
 * Collect, roll up, prune — in that order, every run.
 *
 * The order matters: pruning before the rollup would throw away the raw rows
 * the rollup is computed from. Prune therefore only ever runs last, and only
 * against data far older than the day just rolled up.
 */
export async function runDataCollection({ fetchImpl, now = new Date(), seed = true } = {}) {
  if (seed && (await listSources()).length === 0) {
    for (const source of DEFAULT_SOURCES) await registerSource(source);
  }

  const sources = await dueSources({ now });
  const results = [];

  for (const source of sources) {
    const outcome = await collectSource(source, { fetchImpl, now });
    let inserted = 0;
    let duplicates = 0;

    if (outcome.status === 'OK') {
      ({ inserted, duplicates } = await recordObservations(source.sourceKey, outcome.points));
    }

    await recordSourceRun({
      sourceKey: source.sourceKey,
      status: outcome.status,
      error: outcome.status === 'OK' ? null : outcome.reason
    });

    results.push({
      sourceKey: source.sourceKey,
      status: outcome.status,
      reason: outcome.reason || null,
      points: outcome.points.length,
      inserted,
      duplicates
    });
  }

  const rollup = await rollupDay({ date: now.toISOString() });
  const prune = await pruneRawObservations({ now });

  return {
    collected: results.length,
    ok: results.filter(r => r.status === 'OK').length,
    refused: results.filter(r => r.status === 'REFUSED').length,
    failed: results.filter(r => r.status === 'FAILED').length,
    newPoints: results.reduce((sum, r) => sum + r.inserted, 0),
    rollup,
    prune,
    storage: await storageStats(),
    results
  };
}
