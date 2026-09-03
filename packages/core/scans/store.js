import { databaseEnabled, query } from '@taskman/db';
import { MemoryTable, nowIso } from '../memory-table.js';

const mem = {
  targets: new MemoryTable({ unique: ['targetKey'] }),
  scans: new MemoryTable()
};

const normalizeTarget = (row = {}) => ({
  targetKey: row.targetKey ?? row.target_key,
  targetUrl: row.targetUrl ?? row.target_url,
  category: row.category ?? null,
  notes: row.notes ?? null,
  enabled: row.enabled !== false,
  createdAt: row.createdAt ?? row.created_at ?? null
});

const normalizeScan = (row = {}) => ({
  id: row.id,
  targetKey: row.targetKey ?? row.target_key,
  targetUrl: row.targetUrl ?? row.target_url,
  reachable: Boolean(row.reachable),
  httpStatus: row.httpStatus ?? row.http_status ?? null,
  botDefended: Boolean(row.botDefended ?? row.bot_defended),
  botDefenseVendor: row.botDefenseVendor ?? row.bot_defense_vendor ?? null,
  botDefenseSignal: row.botDefenseSignal ?? row.bot_defense_signal ?? null,
  shape: row.shape || 'unknown',
  shapeConfidence: Number(row.shapeConfidence ?? row.shape_confidence ?? 0),
  verdict: row.verdict,
  evidence: row.evidence || {},
  latencyMs: row.latencyMs ?? row.latency_ms ?? null,
  scannedAt: row.scannedAt ?? row.scanned_at ?? null
});

/** Registration upserts on targetKey — adding a venue never duplicates it. */
export async function registerTarget({ targetKey, targetUrl, category = null, notes = null, enabled = true }) {
  if (!targetKey || !targetUrl) throw new Error('targetKey and targetUrl are required');
  const row = normalizeTarget({ targetKey, targetUrl, category, notes, enabled, createdAt: nowIso() });

  if (!databaseEnabled) {
    mem.targets.upsert(row, { targetUrl, category, notes, enabled });
    return mem.targets.find(t => t.targetKey === targetKey);
  }

  const result = await query(`
    INSERT INTO satellite_targets(target_key, target_url, category, notes, enabled)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT (target_key) DO UPDATE SET
      target_url = EXCLUDED.target_url, category = EXCLUDED.category,
      notes = EXCLUDED.notes, enabled = EXCLUDED.enabled
    RETURNING *
  `, [targetKey, targetUrl, category, notes, enabled]);
  return normalizeTarget(result.rows[0]);
}

export async function listTargets({ enabledOnly = false } = {}) {
  if (!databaseEnabled) {
    return mem.targets.filter(t => !enabledOnly || t.enabled).map(normalizeTarget);
  }
  const where = enabledOnly ? 'WHERE enabled' : '';
  const result = await query(`SELECT * FROM satellite_targets ${where} ORDER BY target_key`);
  return result.rows.map(normalizeTarget);
}

export async function setTargetEnabled(targetKey, enabled) {
  if (!databaseEnabled) {
    const target = mem.targets.find(t => t.targetKey === targetKey);
    if (target) target.enabled = Boolean(enabled);
    return target ? normalizeTarget(target) : null;
  }
  const result = await query(
    `UPDATE satellite_targets SET enabled=$2 WHERE target_key=$1 RETURNING *`,
    [targetKey, Boolean(enabled)]
  );
  return result.rows[0] ? normalizeTarget(result.rows[0]) : null;
}

/** Every scan is appended, never overwritten — history of a venue's shape over time. */
export async function recordScan(scan) {
  const row = normalizeScan({ ...scan, id: crypto.randomUUID() });
  if (!databaseEnabled) {
    mem.scans.insert(row);
    return row;
  }
  const result = await query(`
    INSERT INTO satellite_scans(
      id, target_key, target_url, reachable, http_status, bot_defended,
      bot_defense_vendor, bot_defense_signal, shape, shape_confidence,
      verdict, evidence, latency_ms, scanned_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
    RETURNING *
  `, [
    row.id, row.targetKey, row.targetUrl, row.reachable, row.httpStatus, row.botDefended,
    row.botDefenseVendor, row.botDefenseSignal, row.shape, row.shapeConfidence,
    row.verdict, JSON.stringify(row.evidence), row.latencyMs, row.scannedAt
  ]);
  return normalizeScan(result.rows[0]);
}

/** The most recent scan per target — what a dashboard or the next run actually needs. */
export async function latestScans() {
  if (!databaseEnabled) {
    const byTarget = new Map();
    for (const scan of mem.scans.all()) {
      const current = byTarget.get(scan.targetKey);
      if (!current || new Date(scan.scannedAt) > new Date(current.scannedAt)) byTarget.set(scan.targetKey, scan);
    }
    return [...byTarget.values()].map(normalizeScan);
  }
  const result = await query('SELECT * FROM satellite_scans_latest ORDER BY target_key');
  return result.rows.map(normalizeScan);
}

export async function scanHistory(targetKey, limit = 20) {
  if (!databaseEnabled) {
    return mem.scans.filter(s => s.targetKey === targetKey)
      .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt))
      .slice(0, limit).map(normalizeScan);
  }
  const result = await query(
    'SELECT * FROM satellite_scans WHERE target_key=$1 ORDER BY scanned_at DESC LIMIT $2',
    [targetKey, limit]
  );
  return result.rows.map(normalizeScan);
}

export function resetScanMemory() { mem.targets.clear(); mem.scans.clear(); }
