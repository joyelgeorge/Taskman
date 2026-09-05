import { databaseEnabled, query, truncateForTesting } from '@taskman/db';
import { MemoryTable, nowIso } from '../memory-table.js';

const mem = {
  sources: new MemoryTable({ unique: ['sourceKey'] }),
  observations: new MemoryTable({ unique: ['seriesKey', 'observedAt'] }),
  rollups: new MemoryTable({ unique: ['seriesKey', 'bucketDate'] })
};

export const RAW_RETENTION_DAYS = 90;

const normalizeSource = (row = {}) => ({
  sourceKey: row.sourceKey ?? row.source_key,
  kind: row.kind,
  url: row.url,
  config: row.config || {},
  licence: row.licence,
  decision: row.decision,
  enabled: row.enabled !== false,
  intervalSeconds: Number(row.intervalSeconds ?? row.interval_seconds ?? 86400),
  lastRunAt: row.lastRunAt ?? row.last_run_at ?? null,
  lastOkAt: row.lastOkAt ?? row.last_ok_at ?? null,
  lastError: row.lastError ?? row.last_error ?? null,
  consecutiveFailures: Number(row.consecutiveFailures ?? row.consecutive_failures ?? 0),
  // Whether the publisher archives this series too. The single fact that decides
  // if keeping it builds an asset or just a hosting bill — see
  // packages/core/income/data-products.js.
  reconstructible: row.reconstructible ?? null,
  reconstructibleNote: row.reconstructibleNote ?? row.reconstructible_note ?? null
});

const normalizeObservation = (row = {}) => ({
  id: row.id,
  sourceKey: row.sourceKey ?? row.source_key,
  seriesKey: row.seriesKey ?? row.series_key,
  valueNum: row.valueNum ?? row.value_num ?? null,
  valueText: row.valueText ?? row.value_text ?? null,
  payload: row.payload || {},
  observedAt: row.observedAt ?? row.observed_at ?? null
});

/**
 * A source must declare its licence and the decision it changes. Both are
 * required, not optional metadata: a series whose licence is unknown is a
 * legal liability, and one that answers no question is storage cost with extra
 * steps (docs/DATA_ECOSYSTEM.md §5).
 */
export async function registerSource({
  sourceKey, kind, url, config = {}, licence, decision, enabled = true, intervalSeconds = 86400,
  reconstructible = null, reconstructibleNote = null
}) {
  if (!sourceKey || !kind || !url) throw new Error('sourceKey, kind and url are required');
  if (!licence) throw new Error('licence is required — a series whose licence is unknown is not collected');
  if (!decision) throw new Error('decision is required — name the decision this series changes before adding it');

  const row = normalizeSource({
    sourceKey, kind, url, config, licence, decision, enabled, intervalSeconds,
    reconstructible, reconstructibleNote
  });

  if (!databaseEnabled) {
    mem.sources.upsert(row, {
      kind, url, config, licence, decision, enabled, intervalSeconds, reconstructible, reconstructibleNote
    });
    return mem.sources.find(s => s.sourceKey === sourceKey);
  }

  const result = await query(`
    INSERT INTO observation_sources(source_key, kind, url, config, licence, decision, enabled,
      interval_seconds, reconstructible, reconstructible_note)
    VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (source_key) DO UPDATE SET
      kind=EXCLUDED.kind, url=EXCLUDED.url, config=EXCLUDED.config,
      licence=EXCLUDED.licence, decision=EXCLUDED.decision,
      enabled=EXCLUDED.enabled, interval_seconds=EXCLUDED.interval_seconds,
      reconstructible=EXCLUDED.reconstructible, reconstructible_note=EXCLUDED.reconstructible_note
    RETURNING *
  `, [sourceKey, kind, url, JSON.stringify(config), licence, decision, enabled, intervalSeconds,
      reconstructible, reconstructibleNote]);
  return normalizeSource(result.rows[0]);
}

export async function listSources({ enabledOnly = false } = {}) {
  if (!databaseEnabled) {
    return mem.sources.filter(s => !enabledOnly || s.enabled).map(normalizeSource);
  }
  const where = enabledOnly ? 'WHERE enabled' : '';
  const result = await query(`SELECT * FROM observation_sources ${where} ORDER BY source_key`);
  return result.rows.map(normalizeSource);
}

export async function dueSources({ now = new Date() } = {}) {
  if (!databaseEnabled) {
    return mem.sources.filter(s => {
      if (!s.enabled) return false;
      if (!s.lastRunAt) return true;
      return now - new Date(s.lastRunAt) >= s.intervalSeconds * 1000;
    }).map(normalizeSource);
  }
  const result = await query(`
    SELECT * FROM observation_sources
    WHERE enabled AND (last_run_at IS NULL OR last_run_at <= $1::timestamptz - (interval_seconds * INTERVAL '1 second'))
    ORDER BY last_run_at ASC NULLS FIRST
  `, [now]);
  return result.rows.map(normalizeSource);
}

export async function recordSourceRun({ sourceKey, status, error = null }) {
  const ok = status === 'OK';
  if (!databaseEnabled) {
    const source = mem.sources.find(s => s.sourceKey === sourceKey);
    if (source) {
      source.lastRunAt = nowIso();
      source.lastError = error;
      source.consecutiveFailures = ok ? 0 : source.consecutiveFailures + 1;
      if (ok) source.lastOkAt = source.lastRunAt;
    }
    return source ? normalizeSource(source) : null;
  }
  const result = await query(`
    UPDATE observation_sources SET
      last_run_at = now(),
      last_ok_at = CASE WHEN $2 THEN now() ELSE last_ok_at END,
      last_error = $3,
      consecutive_failures = CASE WHEN $2 THEN 0 ELSE consecutive_failures + 1 END
    WHERE source_key = $1 RETURNING *
  `, [sourceKey, ok, error]);
  return result.rows[0] ? normalizeSource(result.rows[0]) : null;
}

/** Re-collecting the same point is a no-op, so a double cron run cannot corrupt a series. */
export async function recordObservations(sourceKey, points = []) {
  let inserted = 0;
  let duplicates = 0;

  for (const point of points) {
    const row = normalizeObservation({
      id: crypto.randomUUID(), sourceKey,
      series_key: point.seriesKey, value_num: point.valueNum, value_text: point.valueText,
      payload: point.payload, observed_at: point.observedAt
    });

    if (!databaseEnabled) {
      const result = mem.observations.insert(row);
      result.inserted ? inserted += 1 : duplicates += 1;
      continue;
    }

    const result = await query(`
      INSERT INTO observations(id, source_key, series_key, value_num, value_text, payload, observed_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)
      ON CONFLICT (series_key, observed_at) DO NOTHING
      RETURNING id
    `, [row.id, sourceKey, row.seriesKey, row.valueNum, row.valueText, JSON.stringify(row.payload), row.observedAt]);
    result.rowCount ? inserted += 1 : duplicates += 1;
  }

  return { inserted, duplicates };
}

export async function listObservations({ seriesKey = null, limit = 100 } = {}) {
  if (!databaseEnabled) {
    return mem.observations
      .filter(o => !seriesKey || o.seriesKey === seriesKey)
      .sort((a, b) => new Date(b.observedAt) - new Date(a.observedAt))
      .slice(0, limit).map(normalizeObservation);
  }
  const params = [];
  let where = '';
  if (seriesKey) { params.push(seriesKey); where = 'WHERE series_key = $1'; }
  params.push(Math.min(Number(limit) || 100, 1000));
  const result = await query(
    `SELECT * FROM observations ${where} ORDER BY observed_at DESC LIMIT $${params.length}`, params
  );
  return result.rows.map(normalizeObservation);
}

/**
 * Collapses raw points into one row per series per day.
 *
 * This is the part that makes "free forever" real — the rollup is ~1/100th the
 * size of the raw rows and is what any downstream question actually needs, so
 * raw data becomes disposable rather than a growing bill.
 */
export async function rollupDay({ date = null } = {}) {
  const bucket = (date || new Date().toISOString()).slice(0, 10);

  if (!databaseEnabled) {
    const bySeries = new Map();
    for (const obs of mem.observations.all()) {
      if (String(obs.observedAt).slice(0, 10) !== bucket) continue;
      if (obs.valueNum == null) continue;
      if (!bySeries.has(obs.seriesKey)) bySeries.set(obs.seriesKey, []);
      bySeries.get(obs.seriesKey).push(obs);
    }
    let rolled = 0;
    for (const [seriesKey, points] of bySeries) {
      const values = points.map(p => Number(p.valueNum));
      const sorted = [...points].sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt));
      // Full row as both the match target and the payload: MemoryTable.upsert
      // pushes `row` verbatim on insert and only applies `patch` on conflict,
      // so passing a bare key as `row` would store a rollup with no statistics.
      const row = {
        seriesKey, bucketDate: bucket,
        sampleCount: values.length,
        valueMin: Math.min(...values), valueMax: Math.max(...values),
        valueAvg: values.reduce((s, v) => s + v, 0) / values.length,
        valueLast: Number(sorted[sorted.length - 1].valueNum)
      };
      mem.rollups.upsert(row, row);
      rolled += 1;
    }
    return { bucketDate: bucket, seriesRolled: rolled };
  }

  const result = await query(`
    INSERT INTO observation_rollups(series_key, bucket_date, sample_count, value_min, value_max, value_avg, value_last)
    SELECT series_key, $1::date, COUNT(*)::int, MIN(value_num), MAX(value_num), AVG(value_num),
           (ARRAY_AGG(value_num ORDER BY observed_at DESC))[1]
    FROM observations
    WHERE value_num IS NOT NULL AND observed_at >= $1::date AND observed_at < ($1::date + INTERVAL '1 day')
    GROUP BY series_key
    ON CONFLICT (series_key, bucket_date) DO UPDATE SET
      sample_count=EXCLUDED.sample_count, value_min=EXCLUDED.value_min, value_max=EXCLUDED.value_max,
      value_avg=EXCLUDED.value_avg, value_last=EXCLUDED.value_last, updated_at=now()
    RETURNING series_key
  `, [bucket]);
  return { bucketDate: bucket, seriesRolled: result.rowCount };
}

/** Deletes raw rows past retention. Only ever runs after the day is rolled up. */
export async function pruneRawObservations({ retentionDays = RAW_RETENTION_DAYS, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();

  if (!databaseEnabled) {
    const removed = mem.observations.remove(o => o.observedAt < cutoff);
    return { cutoff, removed };
  }
  const result = await query('DELETE FROM observations WHERE observed_at < $1', [cutoff]);
  return { cutoff, removed: result.rowCount };
}

export async function listRollups({ seriesKey = null, limit = 90 } = {}) {
  if (!databaseEnabled) {
    return mem.rollups
      .filter(r => !seriesKey || r.seriesKey === seriesKey)
      .sort((a, b) => (a.bucketDate < b.bucketDate ? 1 : -1))
      .slice(0, limit);
  }
  const params = [];
  let where = '';
  if (seriesKey) { params.push(seriesKey); where = 'WHERE series_key = $1'; }
  params.push(Math.min(Number(limit) || 90, 1000));
  const result = await query(
    `SELECT * FROM observation_rollups ${where} ORDER BY bucket_date DESC LIMIT $${params.length}`, params
  );
  return result.rows.map(r => ({
    seriesKey: r.series_key,
    bucketDate: typeof r.bucket_date === 'string' ? r.bucket_date : r.bucket_date.toISOString().slice(0, 10),
    sampleCount: Number(r.sample_count),
    valueMin: r.value_min == null ? null : Number(r.value_min),
    valueMax: r.value_max == null ? null : Number(r.value_max),
    valueAvg: r.value_avg == null ? null : Number(r.value_avg),
    valueLast: r.value_last == null ? null : Number(r.value_last)
  }));
}

/** Storage footprint, so growth is visible before it becomes a problem. */
export async function storageStats() {
  if (!databaseEnabled) {
    return {
      rawObservations: mem.observations.all().length,
      rollupRows: mem.rollups.all().length,
      sources: mem.sources.all().length,
      retentionDays: RAW_RETENTION_DAYS
    };
  }
  const result = await query(`
    SELECT
      (SELECT COUNT(*) FROM observations)::int AS raw,
      (SELECT COUNT(*) FROM observation_rollups)::int AS rollups,
      (SELECT COUNT(*) FROM observation_sources)::int AS sources,
      pg_size_pretty(pg_total_relation_size('observations')) AS raw_size,
      pg_size_pretty(pg_total_relation_size('observation_rollups')) AS rollup_size
  `);
  const row = result.rows[0];
  return {
    rawObservations: row.raw,
    rollupRows: row.rollups,
    sources: row.sources,
    rawSize: row.raw_size,
    rollupSize: row.rollup_size,
    retentionDays: RAW_RETENTION_DAYS
  };
}

export async function resetObservationMemory() {
  mem.sources.clear(); mem.observations.clear(); mem.rollups.clear();
  await truncateForTesting(['observation_rollups', 'observations', 'observation_sources']);
}
