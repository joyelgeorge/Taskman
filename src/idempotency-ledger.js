import { createHash, randomUUID } from 'node:crypto';
import { databaseEnabled, query } from './db.js';

const memoryLedger = new Map();
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 255;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function canonicalRequestHash(route, body) {
  return digest(`${route}\n${canonicalize(body ?? null)}`);
}

export function validateIdempotencyKey(key) {
  return typeof key === 'string' && key.length >= MIN_KEY_LENGTH && key.length <= MAX_KEY_LENGTH
    && /^[\x21-\x7E]+$/.test(key);
}

function memoryKey(scope, route, keyHash) {
  return `${scope}\n${route}\n${keyHash}`;
}

function outcome(row, requestHash) {
  if (row.requestHash !== requestHash) return { conflict: true, shouldExecute: false };
  if (row.status === 'COMPLETED') {
    return {
      replayed: true,
      shouldExecute: false,
      operationId: row.operationId,
      responseStatus: row.responseStatus,
      responseBody: row.responseBody
    };
  }
  return { inProgress: true, shouldExecute: false, operationId: row.operationId };
}

export async function claimIdempotencyKey(key, {
  scope = 'public', route, body = null, ttlMs = DEFAULT_TTL_MS, now = new Date()
} = {}) {
  if (!validateIdempotencyKey(key)) return { invalid: true, shouldExecute: false };
  if (!route || !Number.isInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 7 * DEFAULT_TTL_MS) {
    throw new Error('Invalid idempotency ledger claim configuration');
  }

  const keyHash = digest(key);
  const requestHash = canonicalRequestHash(route, body);
  const operationId = randomUUID();
  const expiresAt = new Date(now.getTime() + ttlMs);

  if (!databaseEnabled) {
    const ledgerKey = memoryKey(scope, route, keyHash);
    const existing = memoryLedger.get(ledgerKey);
    if (existing && existing.expiresAt > now && existing.status !== 'FAILED') return outcome(existing, requestHash);
    if (existing && existing.requestHash !== requestHash && existing.expiresAt > now) {
      return { conflict: true, shouldExecute: false };
    }
    const row = { scope, route, keyHash, requestHash, operationId, status: 'IN_PROGRESS', expiresAt };
    memoryLedger.set(ledgerKey, row);
    return { claimed: true, shouldExecute: true, operationId, requestHash };
  }

  const inserted = await query(`
    INSERT INTO mutation_ledger
      (scope, route, key_hash, request_hash, operation_id, status, expires_at)
    VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', $6)
    ON CONFLICT DO NOTHING
    RETURNING operation_id
  `, [scope, route, keyHash, requestHash, operationId, expiresAt]);
  if (inserted.rowCount === 1) return { claimed: true, shouldExecute: true, operationId, requestHash };

  const replaced = await query(`
    UPDATE mutation_ledger
    SET request_hash=$4, operation_id=$5, status='IN_PROGRESS', response_status=NULL,
        response_body=NULL, error_code=NULL, created_at=$6, updated_at=$6, expires_at=$7
    WHERE scope=$1 AND route=$2 AND key_hash=$3
      AND (expires_at <= $6 OR (status='FAILED' AND request_hash=$4))
    RETURNING operation_id
  `, [scope, route, keyHash, requestHash, operationId, now, expiresAt]);
  if (replaced.rowCount === 1) return { claimed: true, shouldExecute: true, operationId, requestHash };

  const existing = await query(`
    SELECT request_hash, operation_id, status, response_status, response_body
    FROM mutation_ledger WHERE scope=$1 AND route=$2 AND key_hash=$3
  `, [scope, route, keyHash]);
  if (existing.rowCount !== 1) return { inProgress: true, shouldExecute: false };
  const row = existing.rows[0];
  return outcome({
    requestHash: row.request_hash,
    operationId: row.operation_id,
    status: row.status,
    responseStatus: row.response_status,
    responseBody: row.response_body
  }, requestHash);
}

export async function finishIdempotentMutation(key, {
  scope = 'public', route, operationId, responseStatus = 200, responseBody = null
} = {}) {
  const keyHash = digest(key);
  if (!databaseEnabled) {
    const row = memoryLedger.get(memoryKey(scope, route, keyHash));
    if (!row || row.operationId !== operationId || row.status !== 'IN_PROGRESS') throw new Error('Idempotency claim is no longer active');
    Object.assign(row, { status: 'COMPLETED', responseStatus, responseBody });
    return;
  }
  const updated = await query(`
    UPDATE mutation_ledger SET status='COMPLETED', response_status=$1,
      response_body=$2::jsonb, updated_at=now()
    WHERE scope=$3 AND route=$4 AND key_hash=$5 AND operation_id=$6 AND status='IN_PROGRESS'
  `, [responseStatus, JSON.stringify(responseBody), scope, route, keyHash, operationId]);
  if (updated.rowCount !== 1) throw new Error('Idempotency claim is no longer active');
}

export async function failIdempotentMutation(key, {
  scope = 'public', route, operationId, errorCode = 'INTERNAL_ERROR'
} = {}) {
  const keyHash = digest(key);
  if (!databaseEnabled) {
    const row = memoryLedger.get(memoryKey(scope, route, keyHash));
    if (row?.operationId === operationId && row.status === 'IN_PROGRESS') Object.assign(row, { status: 'FAILED', errorCode });
    return;
  }
  await query(`
    UPDATE mutation_ledger SET status='FAILED', error_code=$1, updated_at=now()
    WHERE scope=$2 AND route=$3 AND key_hash=$4 AND operation_id=$5 AND status='IN_PROGRESS'
  `, [errorCode, scope, route, keyHash, operationId]);
}

export function resetMemoryIdempotencyLedger() {
  memoryLedger.clear();
}
