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
  // Seed by difference, not all-or-nothing. Seeding only into an empty store
  // meant a newly declared source never reached an install that already had one:
  // the ephemeral ranking series was added, deployed, and silently never
  // collected, because the ECB row already existed. Registering the missing keys
  // is also what carries a new column (reconstructible) onto existing rows.
  if (seed) {
    const known = new Set((await listSources()).map(s => s.sourceKey));
    for (const source of DEFAULT_SOURCES) {
      if (!known.has(source.sourceKey)) await registerSource(source);
    }
  }

  const sources = await dueSources({ now });
  const results = [];
  const buckets = new Set([now.toISOString().slice(0, 10)]);

  for (const source of sources) {
    const outcome = await collectSource(source, { fetchImpl, now });
    let inserted = 0;
    let duplicates = 0;

    if (outcome.status === 'OK') {
      ({ inserted, duplicates } = await recordObservations(source.sourceKey, outcome.points));
      // Roll up the days the data is actually stamped with, not the day we happen
      // to be running. A feed almost always publishes for an earlier date — ECB's
      // reference rates for 2026-09-03 are what a 2026-09-04 run collects — so
      // rolling only `now` silently rolled zero series and left the raw rows to be
      // pruned at 90 days with nothing durable behind them.
      for (const point of outcome.points) {
        const bucket = String(point.observedAt || '').slice(0, 10);
        if (bucket) buckets.add(bucket);
      }
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

  const rolled = [];
  for (const bucket of [...buckets].sort()) rolled.push(await rollupDay({ date: bucket }));
  const rollup = {
    buckets: rolled.map(r => r.bucketDate),
    seriesRolled: rolled.reduce((sum, r) => sum + r.seriesRolled, 0),
    perBucket: rolled
  };
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
