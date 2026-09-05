import { databaseEnabled, query, truncateForTesting } from '@taskman/db';
import { MemoryTable, nowIso } from '../memory-table.js';

const mem = {
  drones: new MemoryTable({ unique: ['id'] }),
  runs: new MemoryTable()
};

const MAX_CONSECUTIVE_FAILURES = 5;
const BASE_BACKOFF_SECONDS = 900;
const MAX_BACKOFF_SECONDS = 6 * 60 * 60;

function normalize(row = {}) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    targetUrl: row.targetUrl ?? row.target_url,
    config: row.config || {},
    enabled: row.enabled !== false,
    intervalSeconds: Number(row.intervalSeconds ?? row.interval_seconds ?? 3600),
    consecutiveFailures: Number(row.consecutiveFailures ?? row.consecutive_failures ?? 0),
    quarantinedUntil: row.quarantinedUntil ?? row.quarantined_until ?? null,
    lastRunAt: row.lastRunAt ?? row.last_run_at ?? null,
    lastOkAt: row.lastOkAt ?? row.last_ok_at ?? null,
    lastError: row.lastError ?? row.last_error ?? null
  };
}

export async function registerDrone(drone) {
  const item = normalize({ ...drone, target_url: drone.targetUrl });
  if (!item.id || !item.kind || !item.targetUrl) throw new Error('drone requires id, kind and targetUrl');

  if (!databaseEnabled) {
    mem.drones.upsert(item, {
      kind: item.kind, name: item.name, targetUrl: item.targetUrl,
      config: item.config, enabled: item.enabled, intervalSeconds: item.intervalSeconds
    });
    return mem.drones.find(d => d.id === item.id);
  }

  const result = await query(`
    INSERT INTO drones(id, kind, name, target_url, config, enabled, interval_seconds)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)
    ON CONFLICT (id) DO UPDATE SET
      kind = EXCLUDED.kind, name = EXCLUDED.name, target_url = EXCLUDED.target_url,
      config = EXCLUDED.config, interval_seconds = EXCLUDED.interval_seconds, updated_at = now()
    RETURNING *
  `, [item.id, item.kind, item.name, item.targetUrl, JSON.stringify(item.config), item.enabled, item.intervalSeconds]);
  return normalize(result.rows[0]);
}

export async function listDrones() {
  if (!databaseEnabled) return mem.drones.all().map(normalize);
  const result = await query('SELECT * FROM drones ORDER BY id');
  return result.rows.map(normalize);
}

export async function getDrone(id) {
  if (!databaseEnabled) {
    const row = mem.drones.find(d => d.id === id);
    return row ? normalize(row) : null;
  }
  const result = await query('SELECT * FROM drones WHERE id = $1', [id]);
  return result.rows[0] ? normalize(result.rows[0]) : null;
}

/** Drones whose interval has elapsed and whose quarantine, if any, has expired. */
export async function dueDrones({ now = new Date(), limit = 25 } = {}) {
  if (!databaseEnabled) {
    return mem.drones.filter(d => {
      if (!d.enabled) return false;
      if (d.quarantinedUntil && new Date(d.quarantinedUntil) > now) return false;
      if (!d.lastRunAt) return true;
      return now - new Date(d.lastRunAt) >= d.intervalSeconds * 1000;
    }).slice(0, limit).map(normalize);
  }

  const result = await query(`
    SELECT * FROM drones
    WHERE enabled
      AND (quarantined_until IS NULL OR quarantined_until <= $1)
      AND (last_run_at IS NULL OR last_run_at <= $1::timestamptz - (interval_seconds * INTERVAL '1 second'))
    ORDER BY last_run_at ASC NULLS FIRST
    LIMIT $2
  `, [now, limit]);
  return result.rows.map(normalize);
}

function backoffSeconds(failures) {
  return Math.min(BASE_BACKOFF_SECONDS * 2 ** Math.max(0, failures - MAX_CONSECUTIVE_FAILURES), MAX_BACKOFF_SECONDS);
}

/**
 * Records the outcome and applies the failure policy.
 *
 * A drone that keeps failing is quarantined with exponential backoff rather than
 * disabled: a dead endpoint and a briefly unreachable one look identical from
 * here, and only one of them should need a human to switch it back on.
 */
export async function recordDroneRun({ droneId, status, signalsSeen = 0, signalsNew = 0, latencyMs = null, error = null }) {
  const ok = status === 'OK';
  const startedAt = nowIso();

  if (!databaseEnabled) {
    const drone = mem.drones.find(d => d.id === droneId);
    const run = { id: crypto.randomUUID(), droneId, status, signalsSeen, signalsNew, latencyMs, error, startedAt, finishedAt: startedAt };
    mem.runs.insert(run);
    if (drone) {
      drone.lastRunAt = startedAt;
      drone.lastError = error;
      drone.consecutiveFailures = ok ? 0 : drone.consecutiveFailures + 1;
      if (ok) drone.lastOkAt = startedAt;
      drone.quarantinedUntil = !ok && drone.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
        ? new Date(Date.now() + backoffSeconds(drone.consecutiveFailures) * 1000).toISOString()
        : null;
    }
    return run;
  }

  const result = await query(`
    INSERT INTO drone_runs(drone_id, status, signals_seen, signals_new, latency_ms, error, finished_at)
    VALUES($1,$2,$3,$4,$5,$6, now()) RETURNING *
  `, [droneId, status, signalsSeen, signalsNew, latencyMs, error]);

  await query(`
    UPDATE drones SET
      last_run_at = now(),
      last_ok_at = CASE WHEN $2 THEN now() ELSE last_ok_at END,
      last_error = $3,
      consecutive_failures = CASE WHEN $2 THEN 0 ELSE consecutive_failures + 1 END,
      quarantined_until = CASE
        WHEN $2 THEN NULL
        WHEN consecutive_failures + 1 >= $4
          THEN now() + (LEAST($5 * POWER(2, GREATEST(0, consecutive_failures + 1 - $4)), $6) * INTERVAL '1 second')
        ELSE NULL END,
      updated_at = now()
    WHERE id = $1
  `, [droneId, ok, error, MAX_CONSECUTIVE_FAILURES, BASE_BACKOFF_SECONDS, MAX_BACKOFF_SECONDS]);

  return result.rows[0];
}

export async function setDroneEnabled(id, enabled) {
  if (!databaseEnabled) {
    const drone = mem.drones.find(d => d.id === id);
    if (drone) { drone.enabled = Boolean(enabled); drone.quarantinedUntil = null; drone.consecutiveFailures = 0; }
    return drone ? normalize(drone) : null;
  }
  const result = await query(
    `UPDATE drones SET enabled=$2, quarantined_until=NULL, consecutive_failures=0, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, Boolean(enabled)]
  );
  return result.rows[0] ? normalize(result.rows[0]) : null;
}

export async function droneRunHistory(droneId, limit = 20) {
  if (!databaseEnabled) {
    return mem.runs.filter(r => r.droneId === droneId).slice(-limit).reverse();
  }
  const result = await query(
    'SELECT * FROM drone_runs WHERE drone_id=$1 ORDER BY started_at DESC LIMIT $2',
    [droneId, limit]
  );
  return result.rows;
}

export async function resetDroneMemory() {
  mem.drones.clear(); mem.runs.clear();
  await truncateForTesting(['drone_runs', 'drones']);
}
