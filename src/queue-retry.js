import { createHash } from 'node:crypto';

const RETRYABLE_CODES = new Set([
  '408', '425', '429', '500', '502', '503', '504',
  'ABORT_ERR', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ETIMEDOUT',
  '40001', '40P01', '57P01'
]);
const SETUP_CODES = new Set(['MISSING_CAPABILITY', 'SETUP_REQUIRED']);
const AUTH_CODES = new Set(['AUTHORIZATION_DENIED', 'FORBIDDEN', 'SPEND_NOT_AUTHORIZED']);
const PERMANENT_CODES = new Set(['INVALID_INPUT', 'VALIDATION_FAILED', 'UNSUPPORTED_ACTION']);

export function safeErrorCode(error) {
  const raw = error?.code ?? error?.status ?? error?.statusCode ?? 'UNKNOWN';
  return String(raw).toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 64) || 'UNKNOWN';
}

export function classifyQueueFailure(error) {
  const code = safeErrorCode(error);
  if (RETRYABLE_CODES.has(code) || /^5\d\d$/.test(code)) return { code, kind: 'retryable' };
  if (SETUP_CODES.has(code)) return { code, kind: 'setup_required' };
  if (AUTH_CODES.has(code) || code === '401' || code === '403') return { code, kind: 'authorization_blocked' };
  if (PERMANENT_CODES.has(code) || code === '400' || code === '404' || code === '422') return { code, kind: 'non_retryable' };
  return { code, kind: 'unknown' };
}

export function retryDelayMs(attemptCount, { baseMs = 30_000, capMs = 3_600_000, jitter = Math.random } = {}) {
  const attempt = Math.max(1, Math.trunc(Number(attemptCount) || 1));
  const boundedBase = Math.min(Math.max(Number(baseMs) || 30_000, 1_000), 3_600_000);
  const boundedCap = Math.min(Math.max(Number(capMs) || 3_600_000, boundedBase), 86_400_000);
  const ceiling = Math.min(boundedCap, boundedBase * (2 ** Math.min(attempt - 1, 20)));
  const jitterValue = Math.min(Math.max(Number(jitter()), 0), 1);
  return Math.round(ceiling * (0.5 + 0.5 * jitterValue));
}

export function retryTransition(record, error, { now = new Date(), jitter, baseMs, capMs } = {}) {
  const failure = classifyQueueFailure(error);
  const attemptCount = Math.max(0, Number(record.attemptCount ?? record.attempt_count ?? 0)) + 1;
  const maxAttempts = Math.min(Math.max(Number(record.maxAttempts ?? record.max_attempts ?? 5) || 5, 1), 20);
  const terminal = failure.kind !== 'retryable' || attemptCount >= maxAttempts;
  return {
    status: terminal ? 'DEAD_LETTER' : 'RETRY_PENDING',
    attemptCount,
    maxAttempts,
    nextAttemptAt: terminal ? null : new Date(now.getTime() + retryDelayMs(attemptCount, { jitter, baseMs, capMs })).toISOString(),
    lastErrorCode: failure.code,
    lastErrorAt: now.toISOString(),
    deadLetteredAt: terminal ? now.toISOString() : null,
    failureKind: failure.kind,
    releaseClaim: true
  };
}

export function redriveKeyDigest(idempotencyKey) {
  return createHash('sha256').update(String(idempotencyKey)).digest('hex');
}
