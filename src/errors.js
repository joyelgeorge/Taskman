import crypto from 'node:crypto';

export const ERROR_CODES = Object.freeze({
  INVALID_REQUEST: { status: 400, title: 'Invalid request', retryable: false },
  INVALID_JSON: { status: 400, title: 'Request body is not valid JSON', retryable: false },
  INVALID_INTERVAL_MINUTES: { status: 400, title: 'Invalid schedule interval', retryable: false },
  UNAUTHORIZED: { status: 401, title: 'Authentication required', retryable: false },
  FORBIDDEN: { status: 403, title: 'Access denied', retryable: false },
  NOT_FOUND: { status: 404, title: 'Resource not found', retryable: false },
  CONFLICT: { status: 409, title: 'Request conflict', retryable: false },
  SETUP_REQUIRED: { status: 409, title: 'Required integration is not configured', retryable: false },
  BODY_TOO_LARGE: { status: 413, title: 'Request body is too large', retryable: false },
  RATE_LIMITED: { status: 429, title: 'Request rate limited', retryable: true },
  PROVIDER_UNAVAILABLE: { status: 502, title: 'Upstream provider unavailable', retryable: true },
  NO_PROVIDER_CONFIGURED: { status: 503, title: 'No provider is configured', retryable: false },
  DATABASE_NOT_CONFIGURED: { status: 503, title: 'Database is not configured', retryable: false },
  DATABASE_UNAVAILABLE: { status: 503, title: 'Database unavailable', retryable: true },
  SHUTDOWN_IN_PROGRESS: { status: 503, title: 'Service is draining', retryable: true },
  PROVIDER_TIMEOUT: { status: 504, title: 'Upstream provider timed out', retryable: true },
  RUN_DEADLINE_EXCEEDED: { status: 504, title: 'Execution deadline exceeded', retryable: true },
  MODEL_OUTPUT_INVALID: { status: 502, title: 'Model output is invalid', retryable: true },
  INTERNAL_ERROR: { status: 500, title: 'Internal server error', retryable: false }
});

const CODE_ALIASES = Object.freeze({
  ALL_PROVIDERS_FAILED: 'PROVIDER_UNAVAILABLE',
  PROVIDER_ERROR: 'PROVIDER_UNAVAILABLE',
  DEADLINE_EXCEEDED: 'RUN_DEADLINE_EXCEEDED',
  INTERVAL_INVALID: 'INVALID_INTERVAL_MINUTES'
});

export class AppError extends Error {
  constructor(code, { cause, status, retryable } = {}) {
    const canonical = ERROR_CODES[code] ? code : (CODE_ALIASES[code] || 'INTERNAL_ERROR');
    const definition = ERROR_CODES[canonical];
    super(definition.title, { cause });
    this.name = 'AppError';
    this.code = canonical;
    this.statusCode = status || definition.status;
    this.retryable = retryable ?? definition.retryable;
  }
}

export function classifyError(error, fallbackCode = 'INTERNAL_ERROR') {
  if (error instanceof AppError) return error;

  const suppliedCode = String(error?.code || '');
  const canonicalCode = ERROR_CODES[suppliedCode]
    ? suppliedCode
    : CODE_ALIASES[suppliedCode];
  if (canonicalCode) return new AppError(canonicalCode, { cause: error });
  if (error instanceof SyntaxError) return new AppError('INVALID_JSON', { cause: error });
  if (/^(08|53|57P)/.test(suppliedCode)) return new AppError('DATABASE_UNAVAILABLE', { cause: error });

  const status = Number(error?.statusCode || error?.status);
  if (status === 400 || status === 422) return new AppError('INVALID_REQUEST', { cause: error });
  if (status === 401) return new AppError('UNAUTHORIZED', { cause: error });
  if (status === 403) return new AppError('FORBIDDEN', { cause: error });
  if (status === 404) return new AppError('NOT_FOUND', { cause: error });
  if (status === 409) return new AppError('CONFLICT', { cause: error });
  if (status === 413) return new AppError('BODY_TOO_LARGE', { cause: error });
  if (status === 429) return new AppError('RATE_LIMITED', { cause: error });
  if (status === 504) return new AppError('RUN_DEADLINE_EXCEEDED', { cause: error });

  const fallback = ERROR_CODES[fallbackCode] ? fallbackCode : (CODE_ALIASES[fallbackCode] || 'INTERNAL_ERROR');
  return new AppError(fallback, { cause: error });
}

export function stableErrorCode(error, fallbackCode = 'INTERNAL_ERROR') {
  if (typeof error === 'string') {
    if (ERROR_CODES[error]) return error;
    if (CODE_ALIASES[error]) return CODE_ALIASES[error];
  }
  return classifyError(error, fallbackCode).code;
}

export function requestCorrelationId(req) {
  if (typeof req?.taskmanCorrelationId === 'string') return req.taskmanCorrelationId;
  const supplied = req?.headers?.['x-correlation-id'];
  if (typeof supplied === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}

export function sendJson(res, status, body, { correlationId } = {}) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*'
  };
  if (correlationId) headers['x-correlation-id'] = correlationId;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
  return true;
}

export function sendProblem(res, error, {
  req,
  correlationId = requestCorrelationId(req),
  logger = console.error,
  context
} = {}) {
  const classified = classifyError(error);
  logRestrictedError(classified, { correlationId, logger, context });
  res.writeHead(classified.statusCode, {
    'content-type': 'application/problem+json; charset=utf-8',
    'access-control-allow-origin': '*',
    'x-correlation-id': correlationId
  });
  res.end(JSON.stringify({
    type: `https://taskman.local/problems/${classified.code.toLowerCase().replaceAll('_', '-')}`,
    title: ERROR_CODES[classified.code].title,
    status: classified.statusCode,
    code: classified.code,
    correlationId,
    retryable: classified.retryable
  }));
  return true;
}

export function logRestrictedError(error, {
  correlationId = crypto.randomUUID(),
  logger = console.error,
  context
} = {}) {
  const classified = classifyError(error);
  const safeContext = sanitizeLogValue(context);
  logger({
    event: 'taskman_error',
    correlationId,
    code: classified.code,
    retryable: classified.retryable,
    errorType: safeErrorType(error?.cause || error),
    ...(safeContext ? { context: safeContext } : {})
  });
  return correlationId;
}

function sanitizeLogValue(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 128);
  return text || null;
}

function safeErrorType(error) {
  const name = String(error?.name || error?.constructor?.name || 'Error');
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : 'Error';
}
