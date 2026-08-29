import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import {
  configureServerTimeouts,
  loadLimits,
  readJsonBody
} from '../src/limits.js';
import { runWithFallback } from '../src/providers.js';

function requestFrom(chunks) {
  return Readable.from(chunks);
}

test('JSON body reader accepts payloads at the byte limit', async () => {
  const payload = Buffer.from('{"a":1}');
  const parsed = await readJsonBody(requestFrom([payload]), { maxBytes: payload.length });
  assert.deepEqual(parsed, { a: 1 });
});

test('JSON body reader rejects one byte over the limit with HTTP 413 metadata', async () => {
  const payload = Buffer.from('{"a":1}');
  await assert.rejects(
    readJsonBody(requestFrom([payload.subarray(0, 3), payload.subarray(3)]), {
      maxBytes: payload.length - 1
    }),
    error => error.code === 'BODY_TOO_LARGE' && error.statusCode === 413
  );
});

test('stalled provider times out and fallback uses remaining run budget', async () => {
  const stalled = {
    id: 'stalled',
    model: 'test-stalled',
    key: 'not-logged',
    call(_prompt, _key, { signal }) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
  };
  const healthy = {
    id: 'healthy',
    model: 'test-healthy',
    key: 'not-logged',
    async call() {
      return { text: 'ok', inputTokens: 1, outputTokens: 1 };
    }
  };

  const result = await runWithFallback('test', {
    providerList: [stalled, healthy],
    providerTimeoutMs: 20,
    runTimeoutMs: 250
  });

  assert.equal(result.provider, 'healthy');
  assert.equal(result.text, 'ok');
  assert.equal(result.fallbacks[0].code, 'PROVIDER_TIMEOUT');
  assert.equal(JSON.stringify(result).includes('not-logged'), false);
});

test('overall deadline rejects and ignores a late provider success', async () => {
  const late = {
    id: 'late',
    model: 'test-late',
    key: 'secret-value',
    call() {
      return new Promise(resolve => {
        setTimeout(() => resolve({ text: 'too late' }), 80);
      });
    }
  };

  await assert.rejects(
    runWithFallback('test', {
      providerList: [late],
      providerTimeoutMs: 200,
      runTimeoutMs: 20
    }),
    error => error.code === 'RUN_DEADLINE_EXCEEDED' &&
      !String(error.message).includes('secret-value')
  );
});

test('server transport timeout policy is explicit and bounded', () => {
  const limits = loadLimits({
    TASKMAN_HTTP_REQUEST_TIMEOUT_MS: '30000',
    TASKMAN_HTTP_HEADERS_TIMEOUT_MS: '50000',
    TASKMAN_HTTP_KEEP_ALIVE_TIMEOUT_MS: '4000'
  });
  const server = {};
  configureServerTimeouts(server, limits);

  assert.equal(server.requestTimeout, 30000);
  assert.equal(server.headersTimeout, 30000);
  assert.equal(server.keepAliveTimeout, 4000);
});
