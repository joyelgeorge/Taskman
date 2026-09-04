import { databaseEnabled, query, healthCheck as dbHealth, truncateForTesting } from '@taskman/db';
import { MemoryTable, nowIso } from '../memory-table.js';
import { listDrones } from '../drones/store.js';
import { cronStatuses } from '../observability/cron-store.js';
import { openAlert, resolveAlert } from '../observability/alerts.js';
import { droneFetch } from '../drones/fetch.js';

const mem = { health: new MemoryTable() };

export async function recordHealth({ component, status, latencyMs = null, detail = {} }) {
  const row = { id: crypto.randomUUID(), component, status, latencyMs, detail, checkedAt: nowIso() };
  if (!databaseEnabled) { mem.health.insert(row); return row; }
  const result = await query(
    `INSERT INTO component_health(component, status, latency_ms, detail) VALUES($1,$2,$3,$4::jsonb) RETURNING *`,
    [component, status, latencyMs, JSON.stringify(detail)]
  );
  return result.rows[0];
}

export async function latestHealth() {
  if (!databaseEnabled) {
    const byComponent = new Map();
    for (const row of mem.health.all()) {
      const current = byComponent.get(row.component);
      if (!current || new Date(row.checkedAt) > new Date(current.checkedAt)) byComponent.set(row.component, row);
    }
    return [...byComponent.values()];
  }
  const result = await query(`
    SELECT DISTINCT ON (component) * FROM component_health ORDER BY component, checked_at DESC
  `);
  return result.rows;
}

/** Is the database answering, and how fast. */
export async function checkDatabase() {
  const health = await dbHealth();
  return {
    component: 'db',
    status: health.ok ? 'OK' : (health.enabled ? 'DOWN' : 'DEGRADED'),
    latencyMs: health.latencyMs ?? null,
    detail: { enabled: health.enabled, reason: health.reason ?? null }
  };
}

/** Is a deployed service reachable. Used for the API and the UI, which live elsewhere. */
export async function checkEndpoint(component, url, { fetchImpl } = {}) {
  if (!url) return { component, status: 'DEGRADED', latencyMs: null, detail: { reason: 'no URL configured' } };
  try {
    const { status, latencyMs } = await droneFetch(url, { fetchImpl, timeoutMs: 10_000 });
    return { component, status: 'OK', latencyMs, detail: { httpStatus: status, url } };
  } catch (error) {
    return { component, status: 'DOWN', latencyMs: null, detail: { url, reason: String(error.message || error) } };
  }
}

/** A drone is unhealthy when it is quarantined or has never succeeded. */
export async function checkDrones() {
  const drones = await listDrones();
  return drones.map(drone => {
    const quarantined = drone.quarantinedUntil && new Date(drone.quarantinedUntil) > new Date();
    let status = 'OK';
    if (!drone.enabled) status = 'DEGRADED';
    else if (quarantined) status = 'DOWN';
    else if (drone.consecutiveFailures > 0) status = 'DEGRADED';
    return {
      component: `drone:${drone.id}`,
      status,
      latencyMs: null,
      detail: {
        enabled: drone.enabled,
        consecutiveFailures: drone.consecutiveFailures,
        quarantinedUntil: drone.quarantinedUntil,
        lastOkAt: drone.lastOkAt,
        lastError: drone.lastError
      }
    };
  });
}

/**
 * Runs every check, stores the results, and reconciles alerts.
 *
 * Reconciliation is the part that matters: a component returning to OK resolves
 * its alert automatically, so the open-alert list stays a description of now
 * rather than a history of everything that has ever gone wrong.
 */
export async function runHealthChecks({ endpoints = {}, fetchImpl } = {}) {
  const checks = [await checkDatabase()];

  for (const [component, url] of Object.entries(endpoints)) {
    checks.push(await checkEndpoint(component, url, { fetchImpl }));
  }
  checks.push(...(await checkDrones()));

  for (const cron of await cronStatuses()) {
    const status = cron.status === 'OK' || cron.status === 'DISABLED' ? 'OK'
      : cron.status === 'FAILING' ? 'DEGRADED' : 'DOWN';
    checks.push({
      component: `cron:${cron.cronName}`,
      status,
      latencyMs: null,
      detail: { cronStatus: cron.status, silentSeconds: cron.silentSeconds, lastError: cron.lastError }
    });
  }

  for (const check of checks) {
    await recordHealth(check);
    if (check.status === 'DOWN') {
      await openAlert({
        kind: 'component_down',
        component: check.component,
        severity: check.component === 'db' ? 'CRITICAL' : 'WARNING',
        message: `${check.component} is DOWN`,
        detail: check.detail
      });
    } else if (check.status === 'OK') {
      await resolveAlert('component_down', check.component);
    }
  }

  const counts = checks.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] || 0) + 1 }), {});
  return {
    checkedAt: nowIso(),
    total: checks.length,
    counts,
    overall: counts.DOWN ? 'DOWN' : counts.DEGRADED ? 'DEGRADED' : 'OK',
    checks
  };
}

export async function resetHealthMemory() {
  mem.health.clear();
  await truncateForTesting(['component_health']);
}
