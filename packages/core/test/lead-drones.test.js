import assert from 'node:assert';
import test from 'node:test';
import { runLeadDrone } from '../marketing/lead-drones.js';
import { upsertCampaign, listLeads, resetMarketingMemory } from '../marketing/store.js';

const dummyFetch = async () => ({
  ok: true,
  status: 200,
  headers: new Map([['content-type', 'application/json']]),
  text: async () => JSON.stringify([
    { title: 'Engineer 1', email: 'e1@example.com' },
    { title: 'CEO',        email: 'ceo@example.com' },
    { title: 'Engineer 2', email: 'e2@example.com' }
  ])
});

const dummyDrone = {
  id: 'test_drone',
  kind: 'http_json',
  targetUrl: 'https://example.com/api/users',
  config: { itemsPath: '' }
};

test('runLeadDrone without qualifyFn inserts every signal', async () => {
  await resetMarketingMemory();
  await upsertCampaign({ campaignKey: 'test-1', name: 'Test', lane: 'Test Lane', valueProposition: 'Test Value' });

  const result = await runLeadDrone(dummyDrone, 'test-1', { fetchImpl: dummyFetch });
  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.status, 'OK');
  assert.strictEqual(result.seen, 3);
  assert.strictEqual(result.qualified, 3);
  assert.strictEqual(result.inserted, 3);

  const leads = await listLeads({ campaignKey: 'test-1' });
  assert.strictEqual(leads.length, 3);
});

test('runLeadDrone with qualifyFn filters to matching signals only', async () => {
  await resetMarketingMemory();
  await upsertCampaign({ campaignKey: 'test-2', name: 'Test', lane: 'Test Lane', valueProposition: 'Test Value' });

  const qualifyFn = (signal) => {
    if (signal.payload.title === 'CEO') {
      return { qualified: true, contactHint: signal.payload.email };
    }
    return false;
  };

  const result = await runLeadDrone(dummyDrone, 'test-2', { fetchImpl: dummyFetch, qualifyFn });
  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.status, 'OK');
  assert.strictEqual(result.seen, 3);
  assert.strictEqual(result.qualified, 1);
  assert.strictEqual(result.inserted, 1);

  const leads = await listLeads({ campaignKey: 'test-2' });
  assert.strictEqual(leads.length, 1);
  assert.strictEqual(leads[0].rawRecord.payload.title, 'CEO');
  assert.strictEqual(leads[0].contactHint, 'ceo@example.com');
});

test('runLeadDrone fails gracefully on unknown campaign', async () => {
  await resetMarketingMemory();
  const result = await runLeadDrone(dummyDrone, 'unknown', { fetchImpl: dummyFetch });
  assert.strictEqual(result.status, 'FAILED');
  assert.match(result.error, /Campaign not found/);
  assert.ok(Number.isFinite(result.latencyMs));
});

test('runLeadDrone does not fabricate lead sources — source is always DRONE', async () => {
  await resetMarketingMemory();
  await upsertCampaign({ campaignKey: 'test-3', name: 'Test', lane: 'test', valueProposition: 'v' });
  await runLeadDrone(dummyDrone, 'test-3', { fetchImpl: dummyFetch });

  const leads = await listLeads({ campaignKey: 'test-3' });
  for (const lead of leads) {
    assert.strictEqual(lead.source, 'drone', 'source must be DRONE, never MANUAL or fabricated');
  }
});

test('runLeadDrone returns FAILED when fetch throws, without crashing', async () => {
  await resetMarketingMemory();
  await upsertCampaign({ campaignKey: 'test-4', name: 'Test', lane: 'test', valueProposition: 'v' });

  const brokenFetch = async () => { throw new Error('network failure'); };
  const result = await runLeadDrone(dummyDrone, 'test-4', { fetchImpl: brokenFetch });
  assert.strictEqual(result.status, 'FAILED');
  assert.match(result.error, /network failure/);
  assert.strictEqual(result.droneId, dummyDrone.id);
});
