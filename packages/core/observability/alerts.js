import { databaseEnabled, query, truncateForTesting } from '@taskman/db';
import { MemoryTable, nowIso } from '../memory-table.js';

const mem = { alerts: new MemoryTable() };

const normalize = (row = {}) => ({
  id: row.id,
  kind: row.kind,
  severity: row.severity || 'WARNING',
  component: row.component,
  message: row.message,
  detail: row.detail || {},
  openedAt: row.openedAt ?? row.opened_at ?? null,
  resolvedAt: row.resolvedAt ?? row.resolved_at ?? null
});

/**
 * Opens an alert, or leaves the existing open one alone.
 *
 * Idempotent on (kind, component) so a component that has been down for six hours
 * has one alert against it, not six. Re-firing would train the reader to ignore them.
 */
export async function openAlert({ kind, component, message, severity = 'WARNING', detail = {} }) {
  if (!kind || !component || !message) throw new Error('kind, component and message are required');

  if (!databaseEnabled) {
    const existing = mem.alerts.find(a => a.kind === kind && a.component === component && !a.resolvedAt);
    if (existing) return { alert: existing, created: false };
    const alert = normalize({ id: crypto.randomUUID(), kind, component, message, severity, detail, openedAt: nowIso() });
    mem.alerts.insert(alert);
    return { alert, created: true };
  }

  const result = await query(`
    INSERT INTO alerts(kind, component, message, severity, detail)
    VALUES($1,$2,$3,$4,$5::jsonb)
    ON CONFLICT (kind, component) WHERE resolved_at IS NULL DO NOTHING
    RETURNING *
  `, [kind, component, message, severity, JSON.stringify(detail)]);

  if (result.rowCount) return { alert: normalize(result.rows[0]), created: true };
  const existing = await query(
    'SELECT * FROM alerts WHERE kind=$1 AND component=$2 AND resolved_at IS NULL', [kind, component]
  );
  return { alert: existing.rows[0] ? normalize(existing.rows[0]) : null, created: false };
}

export async function resolveAlert(kind, component) {
  if (!databaseEnabled) {
    const alert = mem.alerts.find(a => a.kind === kind && a.component === component && !a.resolvedAt);
    if (!alert) return null;
    alert.resolvedAt = nowIso();
    return alert;
  }
  const result = await query(
    `UPDATE alerts SET resolved_at=now() WHERE kind=$1 AND component=$2 AND resolved_at IS NULL RETURNING *`,
    [kind, component]
  );
  return result.rows[0] ? normalize(result.rows[0]) : null;
}

export async function listAlerts({ open = true, limit = 100 } = {}) {
  if (!databaseEnabled) {
    return mem.alerts.filter(a => (open ? !a.resolvedAt : true)).slice(-limit).reverse();
  }
  const where = open ? 'WHERE resolved_at IS NULL' : '';
  const result = await query(`SELECT * FROM alerts ${where} ORDER BY opened_at DESC LIMIT $1`, [limit]);
  return result.rows.map(normalize);
}

export async function resetAlertMemory() {
  mem.alerts.clear();
  await truncateForTesting(['alerts']);
}
