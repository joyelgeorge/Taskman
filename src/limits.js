function boundedInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function loadLimits(env = process.env) {
  return Object.freeze({
    maxJsonBodyBytes: boundedInteger(env.TASKMAN_MAX_JSON_BODY_BYTES, 1_048_576, { max: 16_777_216 }),
    providerTimeoutMs: boundedInteger(env.TASKMAN_PROVIDER_TIMEOUT_MS, 45_000, { min: 100, max: 600_000 }),
    runTimeoutMs: boundedInteger(env.TASKMAN_RUN_TIMEOUT_MS, 300_000, { min: 100, max: 3_600_000 }),
    requestTimeoutMs: boundedInteger(env.TASKMAN_HTTP_REQUEST_TIMEOUT_MS, 120_000, { min: 1_000, max: 600_000 }),
    headersTimeoutMs: boundedInteger(env.TASKMAN_HTTP_HEADERS_TIMEOUT_MS, 15_000, { min: 1_000, max: 120_000 }),
    keepAliveTimeoutMs: boundedInteger(env.TASKMAN_HTTP_KEEP_ALIVE_TIMEOUT_MS, 5_000, { min: 1_000, max: 120_000 })
  });
}

export const LIMITS = loadLimits();

export class TaskmanError extends Error {
  constructor(message, { code, statusCode = 500, cause } = {}) {
    super(message, { cause });
    this.name = 'TaskmanError';
    this.code = code || 'TASKMAN_ERROR';
    this.statusCode = statusCode;
  }
}

export async function readJsonBody(req, { maxBytes = LIMITS.maxJsonBodyBytes } = {}) {
  const chunks = [];
  let receivedBytes = 0;

  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += bytes.length;
    if (receivedBytes > maxBytes) {
      throw new TaskmanError('Request body exceeds the configured limit', {
        code: 'BODY_TOO_LARGE',
        statusCode: 413
      });
    }
    chunks.push(bytes);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks, receivedBytes).toString('utf8'));
  } catch (error) {
    throw new TaskmanError('Request body is not valid JSON', {
      code: 'INVALID_JSON',
      statusCode: 400,
      cause: error
    });
  }
}

export function createDeadline(timeoutMs, {
  parentSignal,
  code = 'DEADLINE_EXCEEDED',
  message = 'Operation deadline exceeded'
} = {}) {
  const controller = new AbortController();
  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason || new TaskmanError(message, { code }));
    }
  };

  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new TaskmanError(message, { code }));
    }
  }, timeoutMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
  };
}

export function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

export function configureServerTimeouts(server, limits = LIMITS) {
  server.requestTimeout = limits.requestTimeoutMs;
  server.headersTimeout = Math.min(limits.headersTimeoutMs, limits.requestTimeoutMs);
  server.keepAliveTimeout = limits.keepAliveTimeoutMs;
  return server;
}
