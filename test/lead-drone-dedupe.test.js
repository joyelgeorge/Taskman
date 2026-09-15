import test from 'node:test';
import assert from 'node:assert/strict';
import { runLeadDrone } from '../packages/core/marketing/lead-drones.js';
import { upsertCampaign, listLeads, resetMarketingMemory } from '../packages/core/marketing/store.js';

/**
 * runLeadDrone called createLead unconditionally, so flying the same drone twice
 * over a feed that still carries the same items inserted the same lead again.
 * A duplicated lead inflates the count on the way to a first customer and wastes
 * an outreach slot on someone already contacted. The sibling path
 * (lead-persistence.js) already dedupes by rawRecord.repo; this is the same idea
 * keyed on a signal's natural identity (url, then title).
 */

const drone = { id: 'd1', kind: 'test-kind' };
const signals = [
  { url: 'https://a.example/post/1', title: 'needs help securing supabase app' },
  { url: 'https://a.example/post/2', title: 'my lovable app got hacked' }
];
const collector = { collect: async () => ({ signals, meta: {} }) };

// Inject the collector by mocking getCollector via a fetchImpl-style seam.
async function fly(campaignKey) {
  return runLeadDrone(drone, campaignKey, { collectorImpl: collector });
}

test.beforeEach(() => resetMarketingMemory());

test('flying the same drone twice over an unchanged feed does not duplicate leads', async () => {
  await upsertCampaign({ campaignKey: 'c1', name: "test", lane: "test", valueProposition: "test" });

  const first = await fly('c1');
  const second = await fly('c1');

  const leads = await listLeads({ campaignKey: 'c1' });
  assert.equal(leads.length, 2, 'the second flight must add nothing new');
  assert.equal(first.inserted, 2);
  assert.equal(second.inserted, 0);
  assert.equal(second.duplicates, 2);
});

test('a genuinely new signal on a later flight is still added', async () => {
  await upsertCampaign({ campaignKey: 'c2', name: "test", lane: "test", valueProposition: "test" });
  await fly('c2');

  drone.__extra = true;
  const withNew = { collect: async () => ({ signals: [...signals, { url: 'https://a.example/post/3', title: 'new one' }], meta: {} }) };
  const result = await runLeadDrone(drone, 'c2', { collectorImpl: withNew });

  assert.equal(result.inserted, 1, 'only the new signal is added');
  assert.equal((await listLeads({ campaignKey: 'c2' })).length, 3);
});

test('a signal with no url falls back to its title as the key', async () => {
  await upsertCampaign({ campaignKey: 'c3', name: "test", lane: "test", valueProposition: "test" });
  const titleOnly = { collect: async () => ({ signals: [{ title: 'same complaint' }, { title: 'same complaint' }], meta: {} }) };

  await runLeadDrone(drone, 'c3', { collectorImpl: titleOnly });
  const leads = await listLeads({ campaignKey: 'c3' });
  assert.equal(leads.length, 1, 'two identical title-only signals are one lead');
});
