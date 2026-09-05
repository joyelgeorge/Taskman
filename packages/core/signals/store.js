import { databaseEnabled, query, truncateForTesting } from '@taskman/db';
import { MemoryTable, nowIso } from '../memory-table.js';
import { scanSignal } from '../drones/injection.js';

const mem = { signals: new MemoryTable({ unique: ['droneId', 'fingerprint'] }) };

function normalize(row = {}) {
  return {
    id: row.id,
    droneId: row.droneId ?? row.drone_id,
    fingerprint: row.fingerprint,
    kind: row.kind,
    title: row.title ?? null,
    url: row.url ?? null,
    payload: row.payload || {},
    status: row.status || 'NEW',
    score: row.score == null ? null : Number(row.score),
    rejectReason: row.rejectReason ?? row.reject_reason ?? null,
    observedAt: row.observedAt ?? row.observed_at ?? null,
    processedAt: row.processedAt ?? row.processed_at ?? null
  };
}

/**
 * Ingests a drone's harvest.
 *
 * Two things happen before storage: duplicates collapse on (drone, fingerprint),
 * and anything carrying agent-directed text is stored as QUARANTINED so it can be
 * inspected but can never be claimed for processing.
 */
export async function insertSignals(droneId, signals = []) {
  let inserted = 0;
  let duplicates = 0;
  let quarantined = 0;
  const stored = [];

  for (const raw of signals) {
    const injection = scanSignal(raw);
    const status = injection.detected ? 'QUARANTINED' : 'NEW';
    if (injection.detected) quarantined += 1;

    const row = normalize({
      id: crypto.randomUUID(),
      droneId,
      fingerprint: raw.fingerprint,
      kind: raw.kind || 'record',
      title: raw.title ?? null,
      url: raw.url ?? null,
      payload: raw.payload || {},
      status,
      rejectReason: injection.detected ? `injection patterns: ${injection.matches.join(' | ')}`.slice(0, 500) : null,
      observedAt: raw.observedAt || nowIso()
    });

    if (!databaseEnabled) {
      const result = mem.signals.insert(row);
      if (result.inserted) { inserted += 1; stored.push(result.row); } else { duplicates += 1; }
      continue;
    }

    const result = await query(`
      INSERT INTO signals(id, drone_id, fingerprint, kind, title, url, payload, status, reject_reason, observed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
      ON CONFLICT (drone_id, fingerprint) DO NOTHING
      RETURNING *
    `, [row.id, droneId, row.fingerprint, row.kind, row.title, row.url,
        JSON.stringify(row.payload), row.status, row.rejectReason, row.observedAt]);

    if (result.rowCount) { inserted += 1; stored.push(normalize(result.rows[0])); } else { duplicates += 1; }
  }

  return { inserted, duplicates, quarantined, signals: stored };
}

export async function claimNewSignals({ limit = 100 } = {}) {
  if (!databaseEnabled) {
    return mem.signals.filter(s => s.status === 'NEW').slice(0, limit).map(normalize);
  }
  const result = await query(
    `SELECT * FROM signals WHERE status = 'NEW' ORDER BY observed_at ASC LIMIT $1`,
    [limit]
  );
  return result.rows.map(normalize);
}

export async function markSignal(id, { status, score = null, rejectReason = null }) {
  if (!databaseEnabled) {
    const signal = mem.signals.find(s => s.id === id);
    if (!signal) return null;
    Object.assign(signal, { status, score, rejectReason, processedAt: nowIso() });
    return normalize(signal);
  }
  const result = await query(
    `UPDATE signals SET status=$2, score=$3, reject_reason=$4, processed_at=now() WHERE id=$1 RETURNING *`,
    [id, status, score, rejectReason]
  );
  return result.rows[0] ? normalize(result.rows[0]) : null;
}

export async function listSignals({ status = null, limit = 100 } = {}) {
  if (!databaseEnabled) {
    return mem.signals.filter(s => !status || s.status === status)
      .slice(-limit).reverse().map(normalize);
  }
  const params = [];
  let where = '';
  if (status) { params.push(status); where = 'WHERE status = $1'; }
  params.push(limit);
  const result = await query(`SELECT * FROM signals ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
  return result.rows.map(normalize);
}

export async function signalStats() {
  if (!databaseEnabled) {
    const counts = {};
    for (const signal of mem.signals.all()) counts[signal.status] = (counts[signal.status] || 0) + 1;
    return { total: mem.signals.all().length, byStatus: counts };
  }
  const result = await query(`SELECT status, COUNT(*)::int AS count FROM signals GROUP BY status`);
  const byStatus = Object.fromEntries(result.rows.map(r => [r.status, r.count]));
  return { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus };
}

/**
 * Counts how many distinct droneIds produced signals containing any significant
 * word from the given title in the last windowMs milliseconds.
 * Used to compute corroboration_score for economic scoring.
 */
export async function countCorroboratingSignals(titleWords, windowMs = 86400000) {
  if (!titleWords || titleWords.length === 0) return 0;

  if (!databaseEnabled) {
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    const seen = new Set();
    for (const signal of mem.signals.all()) {
      if (!signal.observedAt || signal.observedAt < cutoff) continue;
      const lower = (signal.title ?? '').toLowerCase();
      if (titleWords.some(w => lower.includes(w.toLowerCase()))) {
        seen.add(signal.droneId);
      }
    }
    return seen.size;
  }

  // Build dynamic LIKE clauses: LOWER(title) LIKE $2 OR LOWER(title) LIKE $3 ...
  const params = [windowMs];
  const likeClauses = titleWords.map((word, i) => {
    params.push(`%${word.toLowerCase()}%`);
    return `LOWER(title) LIKE $${i + 2}`;
  });

  const result = await query(
    `SELECT COUNT(DISTINCT drone_id) AS count FROM signals
     WHERE observed_at > NOW() - ($1 * INTERVAL '1 millisecond')
     AND (${likeClauses.join(' OR ')})`,
    params
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function resetSignalMemory() {
  mem.signals.clear();
  await truncateForTesting(['signals']);
}
