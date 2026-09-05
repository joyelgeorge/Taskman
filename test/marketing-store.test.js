import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN_STATUS,
  LEAD_SOURCE,
  LEAD_STATUS,
  upsertCampaign,
  getCampaign,
  listCampaigns,
  createLead,
  getLead,
  updateLeadStatus,
  listLeads,
  resetMarketingMemory
} from '../packages/core/marketing/store.js';

test('upsertCampaign registers and updates campaigns with epoch and budget windowing', async () => {
  resetMarketingMemory();

  const campaign = await upsertCampaign({
    campaignKey: 'unclaimed-property-ca',
    name: 'California Unclaimed Property Outreach',
    lane: 'unclaimed_property',
    valueProposition: 'Identify and claim state-held funds',
    evidence: { unclaimedTotal: '$8.45B held in CA' },
    probationBudgetCents: 5000,
    probationEpoch: 0
  });

  assert.equal(campaign.campaignKey, 'unclaimed-property-ca');
  assert.equal(campaign.status, CAMPAIGN_STATUS.SCOPING);
  assert.equal(campaign.probationBudgetCents, 5000);
  assert.equal(campaign.probationEpoch, 0);

  // Update status and epoch
  const updated = await upsertCampaign({
    campaignKey: 'unclaimed-property-ca',
    name: 'California Unclaimed Property Outreach',
    lane: 'unclaimed_property',
    valueProposition: 'Identify and claim state-held funds',
    status: CAMPAIGN_STATUS.ACTIVE,
    probationBudgetCents: 5000,
    probationEpoch: 1
  });

  assert.equal(updated.status, CAMPAIGN_STATUS.ACTIVE);
  assert.equal(updated.probationEpoch, 1);

  const retrieved = await getCampaign('unclaimed-property-ca');
  assert.equal(retrieved.status, CAMPAIGN_STATUS.ACTIVE);
});

test('createLead stores candidate buyer records and supports status lifecycle', async () => {
  resetMarketingMemory();

  await upsertCampaign({
    campaignKey: 'fiverr-leakage',
    name: 'Fiverr Statement Audit',
    lane: 'fee_reconciliation',
    valueProposition: 'Recover hidden platform fees'
  });

  const lead = await createLead({
    campaignKey: 'fiverr-leakage',
    source: LEAD_SOURCE.DRONE,
    rawRecord: { company: 'Acme Studio', profileUrl: 'https://example.com/acme' },
    contactHint: 'contact@acmestudio.example'
  });

  assert.ok(lead.id);
  assert.equal(lead.campaignKey, 'fiverr-leakage');
  assert.equal(lead.source, LEAD_SOURCE.DRONE);
  assert.equal(lead.status, LEAD_STATUS.NEW);

  // Update status
  const qualified = await updateLeadStatus(lead.id, LEAD_STATUS.QUALIFIED);
  assert.equal(qualified.status, LEAD_STATUS.QUALIFIED);

  const retrieved = await getLead(lead.id);
  assert.equal(retrieved.status, LEAD_STATUS.QUALIFIED);

  const list = await listLeads({ campaignKey: 'fiverr-leakage', status: LEAD_STATUS.QUALIFIED });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, lead.id);
});
