import { databaseEnabled, query, withTransaction } from './db.js';

const queues = new Map();
const state = new Map();

function bucket(name) {
  if (!queues.has(name)) queues.set(name, []);
  return queues.get(name);
}

function normalizeRecord(record = {}) {
  return {
    id: record.id || crypto.randomUUID(),
    queue: record.queue,
    noveltyKey: record.noveltyKey || record.novelty_key || null,
    status: record.status || 'NEW',
    priority: Number(record.priority || 0),
    payload: record.payload || {},
    claimedAt: record.claimedAt || record.claimed_at || null,
    claimedBy: record.claimedBy || record.claimed_by || null,
    createdAt: record.createdAt || record.created_at || new Date().toISOString(),
    updatedAt: record.updatedAt || record.updated_at || new Date().toISOString()
  };
}

export async function upsertRevenueRecord(record) {
  const item = normalizeRecord(record);
  if (!item.queue) throw new Error('queue is required');

  if (!databaseEnabled) {
    const items = bucket(item.queue);
    const existingIndex = item.noveltyKey ? items.findIndex(r => r.noveltyKey === item.noveltyKey) : -1;
    if (existingIndex >= 0) {
      const existing = items[existingIndex];
      items[existingIndex] = normalizeRecord({ ...existing, ...item, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
      return items[existingIndex];
    }
    items.push(item);
    return item;
  }

  const result = await query(`
    INSERT INTO revenue_records(
      id, queue, novelty_key, status, priority, payload, claimed_at, claimed_by, created_at, updated_at
    )
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
    ON CONFLICT (queue, novelty_key) WHERE novelty_key IS NOT NULL
    DO UPDATE SET status=EXCLUDED.status, priority=EXCLUDED.priority, payload=EXCLUDED.payload,
      claimed_at=EXCLUDED.claimed_at, claimed_by=EXCLUDED.claimed_by, updated_at=now()
    RETURNING *
  `, [
    item.id, item.queue, item.noveltyKey, item.status, item.priority, JSON.stringify(item.payload),
    item.claimedAt, item.claimedBy, item.createdAt, item.updatedAt
  ]);
  return normalizeRecord(result.rows[0]);
}

export async function listRevenueRecords(queueName, { status, limit = 100 } = {}) {
  if (!databaseEnabled) {
    return bucket(queueName)
      .filter(r => !status || r.status === status)
      .sort((a,b) => b.priority - a.priority || new Date(a.createdAt) - new Date(b.createdAt))
      .slice(0, Math.min(Number(limit) || 100, 500));
  }
  const params = [queueName];
  let where = 'queue = $1';
  if (status) { params.push(status); where += ` AND status = $${params.length}`; }
  params.push(Math.min(Number(limit) || 100, 500));
  const result = await query(`SELECT * FROM revenue_records WHERE ${where} ORDER BY priority DESC, created_at ASC LIMIT $${params.length}`, params);
  return result.rows.map(normalizeRecord);
}

export async function claimRevenueRecords(queueName, { limit = 10, claimedBy = 'taskman-explorer' } = {}) {
  const take = Math.min(Math.max(Number(limit) || 10, 1), 50);
  if (!databaseEnabled) {
    const now = new Date().toISOString();
    const eligible = bucket(queueName)
      .filter(r => ['NEW','PENDING','PROMISING','NEEDS_EVIDENCE'].includes(r.status) && !r.claimedAt)
      .sort((a,b) => b.priority - a.priority || new Date(a.createdAt) - new Date(b.createdAt))
      .slice(0, take);
    for (const r of eligible) { r.claimedAt = now; r.claimedBy = claimedBy; r.status = 'CLAIMED'; r.updatedAt = now; }
    return eligible;
  }
  return withTransaction(async client => {
    const result = await client.query(`
      WITH picked AS (
        SELECT id FROM revenue_records
        WHERE queue=$1 AND status IN ('NEW','PENDING','PROMISING','NEEDS_EVIDENCE') AND claimed_at IS NULL
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      UPDATE revenue_records r
      SET status='CLAIMED', claimed_at=now(), claimed_by=$3, updated_at=now()
      FROM picked WHERE r.id=picked.id
      RETURNING r.*
    `, [queueName, take, claimedBy]);
    return result.rows.map(normalizeRecord);
  });
}

export async function updateRevenueRecord(id, patch = {}) {
  if (!databaseEnabled) {
    for (const items of queues.values()) {
      const r = items.find(x => x.id === id);
      if (!r) continue;
      Object.assign(r, patch, { updatedAt: new Date().toISOString() });
      return r;
    }
    return null;
  }
  const result = await query(`
    UPDATE revenue_records SET
      status=COALESCE($2,status),
      priority=COALESCE($3,priority),
      payload=CASE WHEN $4::jsonb IS NULL THEN payload ELSE payload || $4::jsonb END,
      claimed_at=CASE WHEN $5 THEN NULL ELSE claimed_at END,
      claimed_by=CASE WHEN $5 THEN NULL ELSE claimed_by END,
      updated_at=now()
    WHERE id=$1 RETURNING *
  `, [id, patch.status || null, patch.priority ?? null, patch.payload ? JSON.stringify(patch.payload) : null, Boolean(patch.releaseClaim)]);
  return result.rows[0] ? normalizeRecord(result.rows[0]) : null;
}

export async function setRevenueState(key, value) {
  if (!databaseEnabled) { state.set(key, value); return { key, value }; }
  const result = await query(`INSERT INTO revenue_scan_state(key,value) VALUES($1,$2::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now() RETURNING *`, [key, JSON.stringify(value)]);
  return result.rows[0];
}

export async function getRevenueState(key) {
  if (!databaseEnabled) return state.get(key) ?? null;
  const result = await query('SELECT value FROM revenue_scan_state WHERE key=$1', [key]);
  return result.rows[0]?.value ?? null;
}

export function revenueStorageMode() { return databaseEnabled ? 'postgres' : 'memory'; }
