import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTREACH_DRAFT_STATUS,
  updateOutreachDraftStatus,
  listOutreachDrafts,
  getOutreachDraft,
  resetOutreachDraftsMemory
} from '../src/transforms/outreach-draft.js';

test('updateOutreachDraftStatus: valid transitions in memory', async () => {
  await resetOutreachDraftsMemory();

  // Fake draft in memory
  const { runOutreachDraftTransform } = await import('../src/transforms/outreach-draft.js');
  const lead = { id: 'l-test', rawRecord: { name: 'Acme Test' } };
  const campaign = { campaignKey: 'c-test', name: 'Test Campaign', evidence: { val: '$100' } };
  
  const gen = await runOutreachDraftTransform({
    lead,
    campaign,
    modelDraftGenerator: async () => ({
      subject: 'Review needed',
      draftText: 'Hello Acme Test, sourced from public directory. Our records note $100 in escrow. Opt out anytime.'
    })
  });

  assert.equal(gen.ok, true);
  const draftId = gen.draft.id;
  assert.equal(gen.draft.status, OUTREACH_DRAFT_STATUS.READY_FOR_REVIEW);

  // Transition: READY_FOR_REVIEW -> SENT
  const sent = await updateOutreachDraftStatus(draftId, OUTREACH_DRAFT_STATUS.SENT);
  assert.equal(sent.status, OUTREACH_DRAFT_STATUS.SENT);

  // Transition: SENT -> CONVERTED
  const converted = await updateOutreachDraftStatus(draftId, OUTREACH_DRAFT_STATUS.CONVERTED);
  assert.equal(converted.status, OUTREACH_DRAFT_STATUS.CONVERTED);
});

test('updateOutreachDraftStatus: invalid transitions are rejected', async () => {
  await resetOutreachDraftsMemory();

  const { runOutreachDraftTransform } = await import('../src/transforms/outreach-draft.js');
  const lead = { id: 'l-test2', rawRecord: { name: 'Beta Test' } };
  const campaign = { campaignKey: 'c-test2', name: 'Test Campaign', evidence: {} };
  
  const gen = await runOutreachDraftTransform({
    lead,
    campaign,
    modelDraftGenerator: async () => ({
      subject: 'Review',
      draftText: 'Hello Beta Test, from public records. No dollars. Opt out if needed.'
    })
  });

  const draftId = gen.draft.id;

  // Direct READY_FOR_REVIEW -> CONVERTED is illegal
  await assert.rejects(
    () => updateOutreachDraftStatus(draftId, OUTREACH_DRAFT_STATUS.CONVERTED),
    /Invalid status transition/
  );

  // Unknown status is illegal
  await assert.rejects(
    () => updateOutreachDraftStatus(draftId, 'NONEXISTENT_STATUS'),
    /Unknown status/
  );
});

test('listOutreachDrafts and getOutreachDraft work as expected', async () => {
  await resetOutreachDraftsMemory();

  const { runOutreachDraftTransform } = await import('../src/transforms/outreach-draft.js');
  const lead = { id: 'l-test3', rawRecord: { name: 'Gamma Test' } };
  const campaign = { campaignKey: 'c-gamma', name: 'Gamma Campaign', evidence: {} };

  const gen = await runOutreachDraftTransform({
    lead,
    campaign,
    modelDraftGenerator: async () => ({
      subject: 'Gamma Subject',
      draftText: 'Hello Gamma Test, sourced from public directory. Opt out here.'
    })
  });

  const fetched = await getOutreachDraft(gen.draft.id);
  assert.ok(fetched);
  assert.equal(fetched.subject, 'Gamma Subject');

  const list = await listOutreachDrafts({ campaignKey: 'c-gamma' });
  assert.equal(list.length, 1);
  assert.equal(list[0].campaignKey, 'c-gamma');

  const filteredOut = await listOutreachDrafts({ status: OUTREACH_DRAFT_STATUS.SENT });
  assert.equal(filteredOut.length, 0);
});
