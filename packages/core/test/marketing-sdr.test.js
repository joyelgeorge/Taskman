import assert from 'node:assert';
import test from 'node:test';
import { compileTemplate } from '../marketing/spintax.js';
import { getNextInbox } from '../marketing/inbox-rotator.js';
import { waterfallEnrich } from '../marketing/enrichment.js';
import { createLead, getLead, resetMarketingMemory, upsertCampaign, LEAD_SOURCE, LEAD_STATUS } from '../marketing/store.js';

test('Spintax Parser evaluates nested spintax and variables', () => {
  const template = '{Hi|Hello} {{firstName}}, {I noticed|I saw} your {post|article}.';
  
  // A deterministic random function for testing
  let callCount = 0;
  const mockRandom = () => {
    // Return 0 for first branch, 0.99 for second, 0 for third
    const vals = [0, 0.99, 0];
    return vals[callCount++] || 0;
  };

  const result = compileTemplate(template, { firstName: 'Alice' }, mockRandom);
  assert.strictEqual(result, 'Hi Alice, I saw your post.');
});

test('Inbox Rotator picks the least-used inbox and enforces limits', () => {
  const inboxes = [
    { id: '1', sentCountToday: 29, dailyLimit: 30 },
    { id: '2', sentCountToday: 15, dailyLimit: 30 },
    { id: '3', sentCountToday: 15, dailyLimit: 30 },
    { id: '4', sentCountToday: 30, dailyLimit: 30 }, // maxed
  ];

  const next = getNextInbox(inboxes);
  assert.ok(['2', '3'].includes(next.id)); // Should pick 2 or 3
  
  inboxes[1].sentCountToday = 16;
  const nextAgain = getNextInbox(inboxes);
  assert.strictEqual(nextAgain.id, '3'); // Now 3 is strictly lowest

  // If all are maxed
  inboxes[0].sentCountToday = 30;
  inboxes[1].sentCountToday = 30;
  inboxes[2].sentCountToday = 30;
  
  assert.throws(() => getNextInbox(inboxes), /All inboxes have reached their daily sending limit/);
});

test('Waterfall Enrichment cascades through providers', async () => {
  await resetMarketingMemory();
  await upsertCampaign({ campaignKey: 'sdr-test', name: 'SDR', lane: 'outbound', valueProposition: 'Value' });
  
  const lead = await createLead({
    campaignKey: 'sdr-test',
    source: LEAD_SOURCE.DRONE,
    rawRecord: { name: 'Bob', company: 'Acme' },
    status: LEAD_STATUS.NEW
  });

  const failProvider = { name: 'Apollo', enrich: async () => null };
  const errorProvider = { name: 'Dropcontact', enrich: async () => { throw new Error('API down'); } };
  const successProvider = { name: 'Prospeo', enrich: async () => ({ email: 'bob@acme.example' }) };
  
  const result = await waterfallEnrich(lead, [failProvider, errorProvider, successProvider]);
  
  assert.strictEqual(result.status, 'SUCCESS');
  assert.strictEqual(result.email, 'bob@acme.example');
  assert.strictEqual(result.provider, 'Prospeo');
  
  const updated = await getLead(lead.id);
  assert.strictEqual(updated.status, LEAD_STATUS.QUALIFIED);
  assert.strictEqual(updated.contactHint, 'bob@acme.example');
  assert.strictEqual(updated.rawRecord.enrichedBy, 'Prospeo');
});

test('Waterfall Enrichment marks as REJECTED if all providers fail', async () => {
  await resetMarketingMemory();
  await upsertCampaign({ campaignKey: 'sdr-test-2', name: 'SDR', lane: 'outbound', valueProposition: 'Value' });
  
  const lead = await createLead({
    campaignKey: 'sdr-test-2',
    source: LEAD_SOURCE.DRONE,
    rawRecord: { name: 'Charlie', company: 'Unknown' },
    status: LEAD_STATUS.NEW
  });

  const failProvider = { name: 'Apollo', enrich: async () => null };
  const result = await waterfallEnrich(lead, [failProvider]);
  
  assert.strictEqual(result.status, 'FAILED');
  
  const updated = await getLead(lead.id);
  assert.strictEqual(updated.status, LEAD_STATUS.REJECTED);
  assert.strictEqual(updated.rawRecord.enrichmentFailed, true);
});
