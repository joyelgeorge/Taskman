import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileContextPack,
  computeContextDigest,
  estimateTokens,
  listContextManifests,
  resetContextCompilerMemory
} from '../src/context-compiler.js';

test('ContextCompiler excludes unrelated facts and keeps relevant candidate context', async () => {
  await resetContextCompilerMemory();

  // Seed 500 unrelated background facts
  const unrelatedBackground = [];
  for (let i = 0; i < 500; i++) {
    unrelatedBackground.push({
      id: `unrelated-${i}`,
      relevant: false,
      content: `Random background noise ${i}`
    });
  }

  const candidate = {
    candidateId: 'cand-target-1',
    title: 'Automated Stripe Settlement Reconciliation',
    noveltyKey: 'novel-stripe-1',
    acceptanceCriteria: 'Reconcile 10 balance transactions'
  };

  const candidateEvidence = [
    { id: 'ev-1', candidateId: 'novel-stripe-1', data: 'Stripe webhook event balance.available' },
    { id: 'ev-unrelated', candidateId: 'other-candidate', data: 'Twitter post' }
  ];

  const pack = await compileContextPack({
    stage: 'VALIDATE',
    candidate,
    candidateEvidence,
    backgroundKnowledge: unrelatedBackground
  });

  // Verify only relevant items are packed
  assert.ok(pack.contextPack.length < 5);
  const categories = pack.contextPack.map(i => i.category);
  assert.ok(categories.includes('MANDATORY_POLICY'));
  assert.ok(categories.includes('CANDIDATE_FACTS'));
  assert.ok(categories.includes('FRESH_EVIDENCE'));
  assert.ok(!categories.includes('BACKGROUND'));

  const evidenceItem = pack.contextPack.find(i => i.category === 'FRESH_EVIDENCE');
  assert.equal(evidenceItem.sourceId, 'ev-1');
});

test('ContextCompiler preserves mandatory policy and candidate facts under tight token budget', async () => {
  await resetContextCompilerMemory();

  const candidate = {
    candidateId: 'cand-tight-budget',
    title: 'Tight Budget Candidate'
  };

  // Provide huge learning inferences that would blow a small budget
  const learningInferences = [
    { id: 'lr-1', confidence: 0.9, statement: 'A'.repeat(2000), scope: 'cand-tight-budget' },
    { id: 'lr-2', confidence: 0.8, statement: 'B'.repeat(2000), scope: 'cand-tight-budget' }
  ];

  const pack = await compileContextPack({
    stage: 'EXECUTE',
    candidate,
    maxBudgetTokens: 100, // Very tight token budget
    learningInferences
  });

  // Mandatory items must NOT be dropped
  const categories = pack.contextPack.map(i => i.category);
  assert.ok(categories.includes('MANDATORY_POLICY'));
  assert.ok(categories.includes('CANDIDATE_FACTS'));

  // Big learning items should have been dropped due to budget pressure
  assert.ok(pack.manifest.manifestSummary.droppedCount > 0);
  assert.ok(!categories.includes('LEARNING_INFERENCE'));
});

test('ContextCompiler generates and persists auditable SHA-256 digest', async () => {
  await resetContextCompilerMemory();

  const candidate = {
    candidateId: 'cand-digest-1',
    title: 'Audit Candidate'
  };

  const pack1 = await compileContextPack({ stage: 'DISCOVER', candidate });
  assert.ok(pack1.manifest.digestSha256);
  assert.match(pack1.manifest.digestSha256, /^[a-f0-9]{64}$/);

  // Stable digest for identical input
  const pack2 = await compileContextPack({ stage: 'DISCOVER', candidate });
  assert.equal(pack1.manifest.digestSha256, pack2.manifest.digestSha256);

  const manifests = await listContextManifests({ stage: 'DISCOVER' });
  assert.equal(manifests.length, 2);
  assert.equal(manifests[0].candidateId, 'cand-digest-1');
});
