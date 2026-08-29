import { createHash } from 'node:crypto';
import { databaseEnabled, query } from './db.js';

const memoryLedger = new Map();

export function hashRequest(route, body) {
  const normalized = typeof body === 'object' && body !== null ? JSON.stringify(body, Object.keys(body).sort()) : String(body || '');
  return createHash('sha256').update(`${route}:${normalized}`).digest('hex');
}

export async function claimIdempotencyKey(key, { route, body, ttlHours = 24 } = {}) {
  if (!key) return { required: false, shouldExecute: true };

  const requestHash = hashRequest(route, body);

  if (!databaseEnabled) {
    const existing = memoryLedger.get(key);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return {
          required: true,
          shouldExecute: false,
          conflict: true,
          error: 'Idempotency key reused with different request payload'
        };
      }
      if (existing.status === 'COMPLETED') {
        return {
          required: true,
          shouldExecute: false,
          replayed: true,
          responseStatus: existing.responseStatus,
          responseBody: existing.responseBody
        };
      }
      if (existing.status === 'IN_PROGRESS') {
        return {
          required: true,
          shouldExecute: false,
          inProgress: true,
          responseStatus: 409,
          error: 'Operation with this idempotency key is currently in progress'
        };
      }
    }

    memoryLedger.set(key, {
      idempotencyKey: key,
      requestHash,
      route,
      status: 'IN_PROGRESS',
      createdAt: new Date().toISOString()
    });

    return { required: true, shouldExecute: true, key, requestHash };
  }

  // PostgreSQL Mode
  try {
    const existing = await query('SELECT * FROM mutation_ledger WHERE idempotency_key = $1', [key]);
    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      if (row.request_hash !== requestHash) {
        return {
          required: true,
          shouldExecute: false,
          conflict: true,
          error: 'Idempotency key reused with different request payload'
        };
      }
      if (row.status === 'COMPLETED') {
        return {
          required: true,
          shouldExecute: false,
          replayed: true,
          responseStatus: row.response_status,
          responseBody: row.response_body
        };
      }
      if (row.status === 'IN_PROGRESS') {
        return {
          required: true,
          shouldExecute: false,
          inProgress: true,
          responseStatus: 409,
          error: 'Operation with this idempotency key is currently in progress'
        };
      }
    }

    await query(`
      INSERT INTO mutation_ledger (idempotency_key, request_hash, route, status, expires_at)
      VALUES ($1, $2, $3, 'IN_PROGRESS', now() + ($4 || ' hours')::interval)
    `, [key, requestHash, route, ttlHours]);

    return { required: true, shouldExecute: true, key, requestHash };
  } catch (err) {
    if (err.code === '23505') { // Unique violation
      return claimIdempotencyKey(key, { route, body, ttlHours });
    }
    throw err;
  }
}

export async function finishIdempotentMutation(key, { responseStatus = 200, responseBody = {} } = {}) {
  if (!key) return;

  if (!databaseEnabled) {
    const existing = memoryLedger.get(key);
    if (existing) {
      existing.status = 'COMPLETED';
      existing.responseStatus = responseStatus;
      existing.responseBody = responseBody;
      existing.updatedAt = new Date().toISOString();
    }
    return;
  }

  await query(`
    UPDATE mutation_ledger
    SET status = 'COMPLETED', response_status = $1, response_body = $2::jsonb, updated_at = now()
    WHERE idempotency_key = $3
  `, [responseStatus, JSON.stringify(responseBody), key]);
}
