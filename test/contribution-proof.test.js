import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTOR_TYPE,
  recordContribution,
  getWorkflowContributions,
  generateShareableOutcomePage,
  getOutcomePage,
  publishOutcomePage,
  resetContributionProofMemory
} from '../src/contribution-proof.js';

test('recordContribution appends and distinguishes human, AI, deterministic, and external actors', () => {
  resetContributionProofMemory();

  recordContribution({
    workflowId: 'wf-001',
    actorType: ACTOR_TYPE.HUMAN,
    actorName: 'founder',
    actionName: 'APPROVE_PAYOUT',
    description: 'Approved customer invoice for recovery'
  });

  recordContribution({
    workflowId: 'wf-001',
    actorType: ACTOR_TYPE.AI,
    actorName: 'model:gpt-4o',
    actionName: 'DISCREPANCY_ANALYSIS',
    description: 'Found $145 platform fee miscalculation',
    costCents: 5
  });

  recordContribution({
    workflowId: 'wf-001',
    actorType: ACTOR_TYPE.DETERMINISTIC,
    actorName: 'system:bank-reconciler',
    actionName: 'CRYPTO_HASH_VERIFY',
    description: 'Matched bank transaction SHA-256'
  });

  const list = getWorkflowContributions('wf-001');
  assert.equal(list.length, 3);
  assert.equal(list[0].actorType, ACTOR_TYPE.HUMAN);
  assert.equal(list[1].actorType, ACTOR_TYPE.AI);
  assert.equal(list[2].actorType, ACTOR_TYPE.DETERMINISTIC);
});

test('generateShareableOutcomePage is private by default, masks secrets, and separates verified from estimated economics', () => {
  resetContributionProofMemory();

  recordContribution({
    workflowId: 'wf-fiverr',
    actorType: ACTOR_TYPE.HUMAN,
    actionName: 'SIGN_OFF',
    description: 'Confirmed recovery'
  });
  recordContribution({
    workflowId: 'wf-fiverr',
    actorType: ACTOR_TYPE.AI,
    actionName: 'EXTRACT_FEES',
    description: 'Extracted fee column'
  });

  const page = generateShareableOutcomePage({
    workflowId: 'wf-fiverr',
    objective: 'Fiverr Statement Fee Audit',
    verifiedOutcomeCents: 14500, // $145.00
    estimatedSavingsCents: 20000,
    evidenceRefs: [
      'https://api.stripe.com/v1/charges?key=sk_live_SECRET12345&foo=bar',
      'sha256:abcd1234ef5678'
    ]
  });

  // Must be private by default
  assert.equal(page.isPublic, false);
  assert.equal(page.publishedAt, null);

  // Economic truth separated
  assert.equal(page.economics.verifiedOutcomeCents, 14500);
  assert.equal(page.economics.estimatedSavingsCents, 20000);

  // Secrets masked
  assert.ok(page.evidenceRefs[0].includes('key=REDACTED'));
  assert.ok(!page.evidenceRefs[0].includes('sk_live_SECRET12345'));

  // Attribution summary
  assert.equal(page.attribution.humanActionsCount, 1);
  assert.equal(page.attribution.aiActionsCount, 1);

  // Explicit publish action required
  const published = publishOutcomePage(page.slug);
  assert.equal(published.isPublic, true);
  assert.ok(published.publishedAt);
});
