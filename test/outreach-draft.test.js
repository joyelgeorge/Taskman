import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOutreachDraftPostCondition,
  runOutreachDraftTransform,
  OUTREACH_DRAFT_STATUS,
  resetOutreachDraftsMemory
} from '../src/transforms/outreach-draft.js';
import { databaseEnabled } from '../src/db.js';
import { upsertCampaign, createLead, resetMarketingMemory } from '@taskman/core/marketing/store.js';

/**
 * outreach_drafts.lead_id is a real foreign key to leads(id), a UUID. Production
 * only ever drafts for a lead a campaign actually produced; the memory store
 * enforced nothing, so a literal 'l1' passed there and failed against PostgreSQL.
 */
async function realLead(name) {
  if (!databaseEnabled) return { id: 'l1', rawRecord: { name } };
  await resetMarketingMemory();
  const campaign = await upsertCampaign({
    campaignKey: 'c1', name: 'Escrow Audit', lane: 'audit',
    valueProposition: 'Reconcile payouts against deposits'
  });
  const lead = await createLead({
    campaignKey: campaign.campaignKey, source: 'manual', rawRecord: { name }
  });
  return { id: lead.id, rawRecord: { name } };
}

test('validateOutreachDraftPostCondition rejects fabricated dollar figures', () => {
  const lead = { id: 'l1', rawRecord: { name: 'Acme LLC' } };
  const campaign = { campaignKey: 'c1', evidence: { total: '$5,000 in escrow' } };

  // Claims $50,000 which is fabricated
  const badDraft = 'Hello Acme LLC, sourced from public records. We found $50,000 for you. Please let me know if not interested to opt out.';
  const resBad = validateOutreachDraftPostCondition({ draftText: badDraft, lead, campaign });
  assert.equal(resBad.ok, false);
  assert.ok(resBad.reason.includes('Fabricated dollar figure "$50,000"'));

  // Valid draft with $5,000 from campaign evidence
  const goodDraft = 'Hello Acme LLC, sourced from public directory. Our records note $5,000 in escrow. Opt out anytime if not interested.';
  const resGood = validateOutreachDraftPostCondition({ draftText: goodDraft, lead, campaign });
  assert.equal(resGood.ok, true);
});

test('validateOutreachDraftPostCondition rejects false relationship claims and missing opt-out', () => {
  const lead = { id: 'l1', rawRecord: { name: 'Acme LLC' } };
  const campaign = { campaignKey: 'c1', evidence: {} };

  // False relationship claim
  const claimDraft = 'Hello Acme LLC, per our previous call, found your listing in public records. Opt out anytime.';
  const resClaim = validateOutreachDraftPostCondition({ draftText: claimDraft, lead, campaign });
  assert.equal(resClaim.ok, false);
  assert.ok(resClaim.reason.includes('forbidden relationship'));

  // Missing opt-out
  const noOptOutDraft = 'Hello Acme LLC, found your listing in public records. Reply back quickly!';
  const resNoOptOut = validateOutreachDraftPostCondition({ draftText: noOptOutDraft, lead, campaign });
  assert.equal(resNoOptOut.ok, false);
  assert.ok(resNoOptOut.reason.includes('fails to include an opt-out'));
});

test('runOutreachDraftTransform discards invalid drafts and stores valid drafts in READY_FOR_REVIEW', async () => {
  await resetOutreachDraftsMemory();

  const lead = await realLead('Beta Corp');
  const campaign = { campaignKey: 'c1', name: 'Escrow Audit', evidence: { amount: '$1,200' } };

  // 1. Invalid draft -> discarded
  const resultDiscard = await runOutreachDraftTransform({
    lead,
    campaign,
    modelDraftGenerator: async () => ({
      draftText: 'Hello Beta Corp, as your account manager, we recovered $99,000. Sourced from public records.'
    })
  });
  assert.equal(resultDiscard.ok, false);
  assert.equal(resultDiscard.discarded, true);

  // 2. Valid draft -> stored in READY_FOR_REVIEW
  const resultValid = await runOutreachDraftTransform({
    lead,
    campaign,
    modelDraftGenerator: async () => ({
      subject: 'Regarding Beta Corp Listing',
      draftText: 'Hello Beta Corp, we identified an uncollected $1,200 in the public registry. Please decline or opt out if not interested.'
    })
  });
  assert.equal(resultValid.ok, true);
  assert.equal(resultValid.draft.status, OUTREACH_DRAFT_STATUS.READY_FOR_REVIEW);
  assert.equal(resultValid.draft.subject, 'Regarding Beta Corp Listing');
});
