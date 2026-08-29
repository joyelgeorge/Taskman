import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoltJobsWebhook, sendMoltJobsHeartbeat } from '../src/moltjobs-client.js';

test('parses documented webhook envelope without treating it as an assignment', () => {
  assert.deepEqual(parseMoltJobsWebhook({ event: 'message.created', data: { id: 'msg_1' } }), {
    event: 'message.created', data: { id: 'msg_1' }
  });
});

test('heartbeat fails closed without api key', async () => {
  await assert.rejects(() => sendMoltJobsHeartbeat({ agentId: 'agent_1', jobId: 'job_1', statusReport: 'Working', apiKey: '' }), /MOLTJOBS_API_KEY/);
});

test('heartbeat fails closed without agentId', async () => {
  await assert.rejects(() => sendMoltJobsHeartbeat({ agentId: '', jobId: 'job_1', statusReport: 'Working', apiKey: 'test-key' }), /agentId/);
});

test('heartbeat fails closed without assigned jobId', async () => {
  await assert.rejects(() => sendMoltJobsHeartbeat({ agentId: 'agent_1', jobId: '', statusReport: 'Working', apiKey: 'test-key' }), /jobId/);
});

test('heartbeat follows the documented v1 agent endpoint and body contract', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 201, text: async () => '{"data":{"ok":true}}' };
  };
  const result = await sendMoltJobsHeartbeat({
    agentId: 'agent/123',
    jobId: 'job_123',
    statusReport: 'Working on the task.',
    runtimeMetadata: { runtime: 'taskman' },
    apiKey: 'safe-key',
    fetchImpl
  });
  assert.equal(request.url, 'https://api.moltjobs.io/v1/agents/agent%2F123/heartbeat');
  assert.deepEqual(JSON.parse(request.options.body), {
    jobId: 'job_123',
    statusReport: 'Working on the task.',
    runtimeMetadata: { runtime: 'taskman' }
  });
  assert.equal(request.options.headers['X-Api-Key'], 'safe-key');
  assert.equal(request.options.headers.authorization, undefined);
  assert.deepEqual(result, { data: { ok: true } });
});

test('legacy progress input maps to statusReport', async () => {
  let sentBody;
  const fetchImpl = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return { ok: true, status: 201, text: async () => '' };
  };
  await sendMoltJobsHeartbeat({
    agentId: 'agent_1', jobId: 'job_1', progress: 'Still working', apiKey: 'safe-key', fetchImpl
  });
  assert.deepEqual(sentBody, { jobId: 'job_1', statusReport: 'Still working' });
});
