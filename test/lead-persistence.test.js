import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistLeads, VIBE_CAMPAIGN } from '../packages/core/targets/lead-persistence.js';

/**
 * The gap this closes: hunt-vibe-leads.mjs wrote its results to
 * /tmp/vibe-leads.json, which the CI runner destroys. Every Monday it found
 * leads and threw them away, so week 2 never knew what week 1 found.
 */

const fakeStore = () => {
  const campaigns = new Map();
  const leads = [];
  return {
    campaigns, leads,
    upsertCampaign: async (c) => { campaigns.set(c.campaignKey, c); return c; },
    listLeads: async ({ campaignKey }) => leads.filter(l => l.campaignKey === campaignKey),
    createLead: async (l) => { const row = { id: `id-${leads.length}`, ...l }; leads.push(row); return row; },
    updateLead: async (id, updates) => {
      const found = leads.find(l => l.id === id);
      if (found) Object.assign(found, updates);
      return found || null;
    }
  };
};

const scan = (repo, findings, genuine = true) => ({
  repo, genuine, meta: { stargazers_count: 10 },
  findings: findings.map(kind => ({ kind, severity: 'HIGH', file: 'a.ts', line: 1 }))
});

test('a confirmed lead is persisted', async () => {
  const store = fakeStore();
  const r = await persistLeads([scan('acme/shop', ['exposed-secret'])], { store });
  assert.equal(r.created, 1);
  assert.equal(store.leads.length, 1);
  assert.equal(store.leads[0].rawRecord.repo, 'acme/shop');
});

test('the campaign is created before the lead that references it', async () => {
  const store = fakeStore();
  await persistLeads([scan('acme/shop', ['exposed-secret'])], { store });
  assert.ok(store.campaigns.has(VIBE_CAMPAIGN.campaignKey), 'lead FK would fail without it');
});

test('re-scanning the same repo updates rather than duplicating', async () => {
  const store = fakeStore();
  await persistLeads([scan('acme/shop', ['exposed-secret'])], { store });
  const r = await persistLeads([scan('acme/shop', ['exposed-secret', 'open-cors'])], { store });
  assert.equal(store.leads.length, 1, 'a second sweep must not create a duplicate');
  assert.equal(r.created, 0);
  assert.equal(r.updated, 1);
  assert.deepEqual(store.leads[0].rawRecord.findingClasses.sort(), ['exposed-secret', 'open-cors']);
});

test('a repo with no findings is not persisted', async () => {
  const store = fakeStore();
  const r = await persistLeads([scan('acme/clean', [])], { store });
  assert.equal(r.created, 0);
  assert.equal(store.leads.length, 0);
});

test('a non-business repo with findings is not persisted', async () => {
  const store = fakeStore();
  const r = await persistLeads([scan('hobby/toy', ['exposed-secret'], false)], { store });
  assert.equal(r.created, 0);
  assert.equal(store.leads.length, 0);
});

test('no file path or line reaches the store', async () => {
  const store = fakeStore();
  await persistLeads([scan('acme/shop', ['exposed-secret'])], { store });
  const serialized = JSON.stringify(store.leads);
  assert.ok(!serialized.includes('a.ts'));
  assert.ok(!serialized.includes('"line"'));
});

test('leads are created as NEW and from a drone, never pre-qualified', async () => {
  const store = fakeStore();
  await persistLeads([scan('acme/shop', ['exposed-secret'])], { store });
  assert.equal(store.leads[0].status, 'NEW');
  assert.equal(store.leads[0].source, 'drone');
});

test('a store failure on one lead does not lose the rest', async () => {
  const store = fakeStore();
  const original = store.createLead;
  let calls = 0;
  store.createLead = async (l) => {
    if (++calls === 1) throw new Error('db down');
    return original(l);
  };
  const r = await persistLeads(
    [scan('a/one', ['exposed-secret']), scan('b/two', ['open-cors'])], { store });
  assert.equal(r.created, 1);
  assert.equal(r.failed, 1);
  assert.equal(store.leads.length, 1, 'the second lead still landed');
});

test('reports a summary the caller can print', async () => {
  const store = fakeStore();
  const r = await persistLeads(
    [scan('a/one', ['exposed-secret']), scan('b/two', []), scan('c/three', ['open-cors'])], { store });
  assert.deepEqual(
    { created: r.created, updated: r.updated, skipped: r.skipped, failed: r.failed },
    { created: 2, updated: 0, skipped: 1, failed: 0 });
});
