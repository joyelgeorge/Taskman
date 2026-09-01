import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AppError,
  classifyError,
  requestCorrelationId,
  sendProblem,
  stableErrorCode
} from '../src/errors.js';
import { createRunRecord, createTaskRecord, finishRunRecord, listRunRecords } from '../src/task-store.js';
import { runWithFallback } from '../src/providers.js';

function responseRecorder() {
  return {
    status: null,
    headers: null,
    payload: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(payload) {
      this.payload = payload;
    }
  };
}

test('unknown exceptions produce RFC 9457 details without raw diagnostics', () => {
  const secret = 'raw-secret-value';
  const encoded = encodeURIComponent(secret);
  const error = new Error(`failed https://provider.invalid?key=${encoded}\nBearer ${secret}`);
  const response = responseRecorder();
  const logs = [];

  sendProblem(response, error, {
    req: { headers: { 'x-correlation-id': 'request-84' } },
    logger: entry => logs.push(entry),
    context: 'test\ncontext'
  });

  const problem = JSON.parse(response.payload);
  assert.equal(response.status, 500);
  assert.equal(response.headers['content-type'], 'application/problem+json; charset=utf-8');
  assert.equal(response.headers['x-correlation-id'], 'request-84');
  assert.deepEqual(problem, {
    type: 'https://taskman.local/problems/internal-error',
    title: 'Internal server error',
    status: 500,
    code: 'INTERNAL_ERROR',
    correlationId: 'request-84',
    retryable: false
  });
  const serialized = JSON.stringify({ problem, logs });
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(encoded), false);
  assert.equal(serialized.includes('provider.invalid'), false);
  assert.equal(serialized.includes('\n'), false);
  assert.equal(logs[0].correlationId, problem.correlationId);
});

test('invalid inbound correlation IDs are replaced', () => {
  const id = requestCorrelationId({ headers: { 'x-correlation-id': 'bad\r\nid' } });
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test('known failures have stable status and retryability', () => {
  const validation = classifyError(new SyntaxError('private parser detail'));
  const rateLimit = classifyError({ status: 429, message: 'private provider body' });
  const database = classifyError({ code: '08006', message: 'private database host' });

  assert.deepEqual([validation.code, validation.statusCode, validation.retryable], ['INVALID_JSON', 400, false]);
  assert.deepEqual([rateLimit.code, rateLimit.statusCode, rateLimit.retryable], ['RATE_LIMITED', 429, true]);
  assert.deepEqual([database.code, database.statusCode, database.retryable], ['DATABASE_UNAVAILABLE', 503, true]);
  assert.equal(stableErrorCode(new AppError('FORBIDDEN')), 'FORBIDDEN');
  assert.equal(stableErrorCode({ code: 'ALL_PROVIDERS_FAILED' }), 'PROVIDER_UNAVAILABLE');
});

test('run records persist stable codes instead of exception messages', async () => {
  const id = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  await createTaskRecord({
    id: taskId,
    scenarioId: null,
    title: 'Error contract fixture',
    prompt: 'Exercise safe persisted error handling',
    intervalMinutes: null
  });
  await createRunRecord({
    id,
    taskId,
    scenarioId: null,
    reason: 'test',
    status: 'running',
    startedAt: new Date().toISOString()
  });
  await finishRunRecord({
    id,
    status: 'failed',
    error: 'raw-secret-value https://database.internal/query',
    errorDetail: 'must-not-persist',
    finishedAt: new Date().toISOString()
  });

  const run = (await listRunRecords(500)).find(item => item.id === id);
  assert.equal(run.error, 'INTERNAL_ERROR');
  assert.equal(run.errorDetail, null);
  assert.equal(JSON.stringify(run).includes('raw-secret-value'), false);
  assert.equal(JSON.stringify(run).includes('must-not-persist'), false);
});

test('provider failures expose only stable bounded diagnostics', async () => {
  const providerList = [{
    id: 'fixture',
    model: 'fixture-model',
    key: 'fixture-secret',
    async call() {
      throw new Error('fixture-secret private prompt https://provider.invalid');
    }
  }];

  await assert.rejects(
    runWithFallback('private prompt', { providerList, runTimeoutMs: 1_000 }),
    error => {
      assert.equal(stableErrorCode(error), 'PROVIDER_UNAVAILABLE');
      const serialized = JSON.stringify({ message: error.message, diagnostics: error.diagnostics });
      assert.equal(serialized.includes('fixture-secret'), false);
      assert.equal(serialized.includes('private prompt'), false);
      assert.equal(serialized.includes('provider.invalid'), false);
      assert.deepEqual(error.diagnostics.map(item => item.code), ['PROVIDER_ERROR']);
      return true;
    }
  );
});
