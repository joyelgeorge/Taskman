import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  INVALID_INTERVAL_CODE,
  MAX_INTERVAL_MINUTES,
  normalizeBrainIntervalMinutes,
  normalizeIntervalMinutes,
  normalizeStoredIntervalSeconds
} from '../src/interval-validator.js';
import { createTaskRecord, listTaskRecords } from '../src/task-store.js';

test('interval normalizer accepts only manual or canonical bounded whole minutes', () => {
  for (const input of [undefined, null, '']) {
    assert.deepEqual(normalizeIntervalMinutes(input), { valid: true, value: null });
  }
  for (const [input, value] of [[1, 1], [MAX_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES], ['15', 15]]) {
    assert.deepEqual(normalizeIntervalMinutes(input), { valid: true, value });
  }
  for (const input of [-1, 0, 0.5, NaN, Infinity, true, {}, 'abc', '1.5', '1e3', '01', ' 1', MAX_INTERVAL_MINUTES + 1]) {
    const result = normalizeIntervalMinutes(input);
    assert.equal(result.valid, false, String(input));
    assert.equal(result.code, INVALID_INTERVAL_CODE);
  }
});

test('brain and stored-trigger normalization use the same canonical contract', () => {
  assert.deepEqual(normalizeBrainIntervalMinutes('5'), { valid: true, value: 5 });
  assert.equal(normalizeBrainIntervalMinutes('-1').valid, false);
  assert.deepEqual(normalizeStoredIntervalSeconds(300), { valid: true, value: 5 });
  assert.equal(normalizeStoredIntervalSeconds(-1).valid, false);
  assert.equal(normalizeStoredIntervalSeconds(30).valid, false);
  assert.equal(normalizeStoredIntervalSeconds((MAX_INTERVAL_MINUTES + 1) * 60).valid, false);
});

test('task store rejects invalid intervals before creating any memory record', async () => {
  const before = (await listTaskRecords()).length;
  await assert.rejects(
    createTaskRecord({ id: crypto.randomUUID(), title: 'bad', prompt: 'not stored', intervalMinutes: -1 }),
    error => error.code === INVALID_INTERVAL_CODE && error.statusCode === 400
  );
  assert.equal((await listTaskRecords()).length, before);
});

test('HTTP API rejects invalid intervals with no task side effect', async t => {
  const port = 42_000 + (process.pid % 1_000);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: '',
      TASKMAN_INTERNAL_SCHEDULER_ENABLED: 'false',
      TASKMAN_BRAIN_INTERVAL_MINUTES: ''
    },
    stdio: 'ignore'
  });
  t.after(() => child.kill('SIGTERM'));

  const base = `http://127.0.0.1:${port}`;
  let baseline;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/tasks`);
      if (response.ok) {
        baseline = await response.json();
        break;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok(Array.isArray(baseline), 'test server did not become ready');

  for (const intervalMinutes of [-1, 0, 0.5, 'abc', '1e3', '01', MAX_INTERVAL_MINUTES + 1]) {
    const response = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'must not be stored', intervalMinutes })
    });
    assert.equal(response.status, 400, String(intervalMinutes));
    const problem = await response.json();
    assert.equal(problem.code, INVALID_INTERVAL_CODE);
    assert.equal(JSON.stringify(problem).includes('must not be stored'), false);
  }

  const after = await (await fetch(`${base}/api/tasks`)).json();
  assert.equal(after.length, baseline.length);
});
