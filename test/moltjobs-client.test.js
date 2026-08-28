import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoltJobsWebhook, sendMoltJobsHeartbeat } from '../src/moltjobs-client.js';

test('parses documented webhook envelope', () => {
  assert.deepEqual(parseMoltJobsWebhook({ event: 'message.created', data: { id: 'msg_1' } }), {
    event: 'message.created', data: { id: 'msg_1' }
  });
});

test('heartbeat fails closed without api key', async () => {
  await assert.rejects(() => sendMoltJobsHeartbeat({ jobId: 'job_1', progress: 'Working', apiKey: '' }), /MOLTJOBS_API_KEY/);
});

test('heartbeat fails closed without assigned jobId', async () => {
  await assert.rejects(() => sendMoltJobsHeartbeat({ jobId: '', progress: 'Working', apiKey: 'test-key' }), /jobId/);
});

test('heartbeat sends only jobId and progress', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, text: async () => '{"ok":true}' };
  };
  const result = await sendMoltJobsHeartbeat({
    jobId: 'job_123', progress: 'Working on the task.', apiKey: 'safe-key', baseUrl: 'https://example.test', fetchImpl
  });
  assert.deepEqual(JSON.parse(request.options.body), { jobId: 'job_123', progress: 'Working on the task.' });
  assert.equal(request.options.headers.authorization, 'Bearer safe-key');
  assert.deepEqual(result, { ok: true });
});
