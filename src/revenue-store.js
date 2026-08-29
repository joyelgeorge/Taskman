import { databaseEnabled, query, withTransaction } from './db.js';
import { redriveKeyDigest, retryTransition } from './queue-retry.js';

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
    attemptCount: Number(record.attemptCount ?? record.attempt_count ?? 0),
    maxAttempts: Math.min(Math.max(Number(record.maxAttempts ?? record.max_attempts ?? 5) || 5, 1), 20),
    nextAttemptAt: record.nextAttemptAt || record.next_attempt_at || null,
    lastErrorCode: record.lastErrorCode || record.last_error_code || null,
    lastErrorAt: record.lastErrorAt || record.last_error_at || null,
    deadLetteredAt: record.deadLetteredAt || record.dead_lettered_at || null,
    failureKind: record.failureKind || record.failure_kind || null,
    lastRedriveKeyHash: record.lastRedriveKeyHash || record.last_redrive_key_hash || null,
    redriveReason: record.redriveReason || record.redrive_reason || null,
    createdAt: record.createdAt || record.created_at || new Date().toISOString(),
    updatedAt: record.updatedAt || record.updated_at || new Date().toISOString()
  };
}

function findMemoryRecord(id) {
  for (const items of queues.values()) {
    const record = items.find(item => item.id === id);
    if (record) return record;
  }
  return null;
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
    INSERT INTO revenue_records(id, queue, novelty_key, status, priority, payload, claimed_at, claimed_by, max_attempts)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
    ON CONFLICT (queue, novelty_key) WHERE novelty_key IS NOT NULL
    DO UPDATE SET status=EXCLUDED.status, priority=EXCLUDED.priority, payload=EXCLUDED.payload,
      claimed_at=EXCLUDED.claimed_at, claimed_by=EXCLUDED.claimed_by, updated_at=now()
    RETURNING *
  `, [item.id, item.queue, item.noveltyKey, item.status, item.priority, JSON.stringify(item.payload), item.claimedAt, item.claimedBy, item.maxAttempts]);
  return normalizeRecord(result.rows[0]);
}

export async function listRevenueRecords(queueName, { status, limit = 100 } = {}) {
  if (!databaseEnabled) {
    return bucket(queueName).filter(r => !status || r.status === status)
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

export async function claimRevenueRecords(queueName, { limit = 10, claimedBy = 'taskman-explorer', now = new Date() } = {}) {
  const take = Math.min(Math.max(Number(limit) || 10, 1), 50);
  if (!databaseEnabled) {
    const nowIso = now.toISOString();
    const eligible = bucket(queueName)
      .filter(r => ['NEW','PENDING','PROMISING','NEEDS_EVIDENCE','RETRY_PENDING'].includes(r.status) && !r.claimedAt && !r.deadLetteredAt && r.attemptCount < r.maxAttempts && (!r.nextAttemptAt || r.nextAttemptAt <= nowIso))
      .sort((a,b) => b.priority - a.priority || new Date(a.createdAt) - new Date(b.createdAt)).slice(0, take);
    for (const r of eligible) { r.claimedAt = nowIso; r.claimedBy = claimedBy; r.status = 'CLAIMED'; r.updatedAt = nowIso; }
    return eligible;
  }
  return withTransaction(async client => {
    const result = await client.query(`
      WITH picked AS (
        SELECT id FROM revenue_records
        WHERE queue=$1 AND status IN ('NEW','PENDING','PROMISING','NEEDS_EVIDENCE','RETRY_PENDING')
          AND claimed_at IS NULL AND dead_lettered_at IS NULL AND attempt_count < max_attempts
          AND (next_attempt_at IS NULL OR next_attempt_at <= $4)
        ORDER BY priority DESC, created_at ASC FOR UPDATE SKIP LOCKED LIMIT $2
      )
      UPDATE revenue_records r SET status='CLAIMED', claimed_at=$4, claimed_by=$3, updated_at=now()
      FROM picked WHERE r.id=picked.id RETURNING r.*
    `, [queueName, take, claimedBy, now]);
    return result.rows.map(normalizeRecord);
  });
}

export async function recordRevenueFailure(id, error, options = {}) {
  if (!databaseEnabled) {
    const record = findMemoryRecord(id);
    if (!record) return null;
    Object.assign(record, retryTransition(record, error, options), { updatedAt: (options.now || new Date()).toISOString(), claimedAt: null, claimedBy: null });
    return record;
  }
  return withTransaction(async client => {
    const selected = await client.query('SELECT * FROM revenue_records WHERE id=$1 FOR UPDATE', [id]);
    if (!selected.rows[0]) return null;
    const transition = retryTransition(normalizeRecord(selected.rows[0]), error, options);
    const result = await client.query(`UPDATE revenue_records SET status=$2, attempt_count=$3, max_attempts=$4,
      next_attempt_at=$5, last_error_code=$6, last_error_at=$7, dead_lettered_at=$8, failure_kind=$9,
      claimed_at=NULL, claimed_by=NULL, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, transition.status, transition.attemptCount, transition.maxAttempts, transition.nextAttemptAt,
       transition.lastErrorCode, transition.lastErrorAt, transition.deadLetteredAt, transition.failureKind]);
    return normalizeRecord(result.rows[0]);
  });
}

export async function redriveRevenueRecord(id, { authorized = false, reason, idempotencyKey } = {}) {
  if (!authorized) throw Object.assign(new Error('redrive authorization required'), { code: 'AUTHORIZATION_DENIED' });
  if (!String(reason || '').trim()) throw Object.assign(new Error('redrive reason required'), { code: 'INVALID_INPUT' });
  if (!String(idempotencyKey || '').trim()) throw Object.assign(new Error('idempotency key required'), { code: 'INVALID_INPUT' });
  const digest = redriveKeyDigest(idempotencyKey);
  const apply = record => {
    if (record.lastRedriveKeyHash === digest) return record;
    if (record.status !== 'DEAD_LETTER') throw Object.assign(new Error('only dead-letter records can be redriven'), { code: 'INVALID_STATE' });
    Object.assign(record, { status: 'PENDING', attemptCount: 0, nextAttemptAt: null, lastErrorCode: null,
      lastErrorAt: null, deadLetteredAt: null, failureKind: null, claimedAt: null, claimedBy: null,
      lastRedriveKeyHash: digest, redriveReason: String(reason).trim().slice(0, 500), updatedAt: new Date().toISOString() });
    return record;
  };
  if (!databaseEnabled) {
    const record = findMemoryRecord(id);
    return record ? apply(record) : null;
  }
  return withTransaction(async client => {
    const selected = await client.query('SELECT * FROM revenue_records WHERE id=$1 FOR UPDATE', [id]);
    if (!selected.rows[0]) return null;
    const record = normalizeRecord(selected.rows[0]);
    if (record.lastRedriveKeyHash === digest) return record;
    apply(record);
    const result = await client.query(`UPDATE revenue_records SET status='PENDING', attempt_count=0,
      next_attempt_at=NULL, last_error_code=NULL, last_error_at=NULL, dead_lettered_at=NULL, failure_kind=NULL,
      claimed_at=NULL, claimed_by=NULL, last_redrive_key_hash=$2, redrive_reason=$3, updated_at=now()
      WHERE id=$1 RETURNING *`, [id, digest, record.redriveReason]);
    return normalizeRecord(result.rows[0]);
  });
}

export async function updateRevenueRecord(id, patch = {}) {
  if (!databaseEnabled) {
    const r = findMemoryRecord(id);
    if (!r) return null;
    Object.assign(r, patch, { updatedAt: new Date().toISOString() });
    return r;
  }
  const result = await query(`UPDATE revenue_records SET status=COALESCE($2,status), priority=COALESCE($3,priority),
    payload=CASE WHEN $4::jsonb IS NULL THEN payload ELSE payload || $4::jsonb END,
    claimed_at=CASE WHEN $5 THEN NULL ELSE claimed_at END, claimed_by=CASE WHEN $5 THEN NULL ELSE claimed_by END,
    updated_at=now() WHERE id=$1 RETURNING *`,
    [id, patch.status || null, patch.priority ?? null, patch.payload ? JSON.stringify(patch.payload) : null, Boolean(patch.releaseClaim)]);
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
