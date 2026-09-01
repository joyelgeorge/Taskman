import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLearningToCandidates,
  compileLearningGuidance,
  evaluatePastGuidance,
  GUIDANCE_EVALUATIONS,
  LEARNING_CLASSIFICATIONS,
  listActiveLearning,
  normalizeLearningInference,
  recordLearningInference
} from '../src/learning-inference.js';
import { runDiscoverWorker } from '../src/workers/discover.js';

const suffix = `${process.pid}-${Date.now()}`;
const evidence = index => `evidence:${suffix}:${index}`;

test('temporary hints are structured, bounded and expiring', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const learning = normalizeLearningInference({
    statement: '  Prefer fresh evidence  ',
    confidence: 2,
    sourceWorker: 'validate',
    supportingEvidence: [evidence(1)],
    weightAdjustment: { target: 'bounty', delta: -4 }
  }, { now });
  assert.equal(learning.classification, LEARNING_CLASSIFICATIONS.TEMPORARY_HINT);
  assert.equal(learning.confidence, 1);
  assert.equal(learning.weightAdjustment.delta, -0.5);
  assert.ok(new Date(learning.expiresAt) > now);
});

test('a claimed durable rule is downgraded without repeated traceable evidence', () => {
  const learning = normalizeLearningInference({
    statement: 'Reject source while adapter is unavailable',
    classification: LEARNING_CLASSIFICATIONS.DURABLE_RULE,
    confidence: 0.99,
    supportingEvidence: [evidence(2), evidence(2)],
    hardFilter: true
  });
  assert.equal(learning.classification, LEARNING_CLASSIFICATIONS.TEMPORARY_HINT);
  assert.equal(learning.evidenceCount, 1);
  assert.equal(learning.hardFilter, false);
});

test('deduplication aggregates independent evidence and promotes only at the durable threshold', async () => {
  const base = {
    statement: `Repeated capability failure ${suffix}`,
    classification: LEARNING_CLASSIFICATIONS.DURABLE_RULE,
    confidence: 0.9,
    sourceWorker: 'execute',
    scope: `source:test-${suffix}`,
    hardFilter: true
  };
  const first = await recordLearningInference({ ...base, supportingEvidence: [evidence(3)] });
  const second = await recordLearningInference({ ...base, supportingEvidence: [evidence(4)] });
  const third = await recordLearningInference({ ...base, supportingEvidence: [evidence(5)] });
  assert.equal(first.id, second.id);
  assert.equal(second.id, third.id);
  assert.equal(third.payload.classification, LEARNING_CLASSIFICATIONS.DURABLE_RULE);
  assert.equal(third.payload.evidenceCount, 3);
  assert.equal(third.payload.hardFilter, true);
});

test('only evidence-qualified durable rules can create hard filters', () => {
  const guidance = compileLearningGuidance([
    { id: 'hint', payload: normalizeLearningInference({
      statement: 'hint', confidence: 0.9, supportingEvidence: [evidence(6)], hardFilter: true,
      scope: 'source:a'
    }) },
    { id: 'rule', payload: normalizeLearningInference({
      statement: 'rule', classification: LEARNING_CLASSIFICATIONS.DURABLE_RULE,
      confidence: 0.9, supportingEvidence: [evidence(7), evidence(8), evidence(9)],
      hardFilter: true, scope: 'source:b'
    }) }
  ]);
  assert.deepEqual(guidance.hardFilters.map(filter => filter.learningId), ['rule']);
});

test('explicit learned weights are clamped and auditable', () => {
  const guidance = compileLearningGuidance([
    { id: 'one', payload: normalizeLearningInference({ statement: 'one', confidence: 0.5,
      supportingEvidence: [evidence(10)], weightAdjustment: { target: 'bounty', delta: 0.4 } }) },
    { id: 'two', payload: normalizeLearningInference({ statement: 'two', confidence: 0.5,
      supportingEvidence: [evidence(11)], weightAdjustment: { target: 'bounty', delta: 0.4 } }) }
  ]);
  assert.equal(guidance.sourceWeights.bounty, 0.5);
  assert.deepEqual(guidance.appliedLearningIds, ['one', 'two']);
});

test('candidate ordering preserves a source-diversity floor', () => {
  const result = applyLearningToCandidates([
    { candidateId: 'a1', sourceType: 'a' },
    { candidateId: 'a2', sourceType: 'a' },
    { candidateId: 'b1', sourceType: 'b' }
  ], { sourceWeights: { a: 0.5, b: -0.5 }, hardFilters: [] }, { minimumSourceDiversity: 2 });
  assert.equal(new Set(result.candidates.slice(0, 2).map(c => c.sourceType)).size, 2);
});

test('valid durable filters remove only their declared scope', () => {
  const result = applyLearningToCandidates([
    { candidateId: 'a1', sourceType: 'a' },
    { candidateId: 'b1', sourceType: 'b' }
  ], { sourceWeights: {}, hardFilters: [{ scope: 'source:a' }] });
  assert.deepEqual(result.candidates.map(c => c.candidateId), ['b1']);
  assert.deepEqual(result.hardFiltered.map(c => c.candidateId), ['a1']);
});

test('useful validation strengthens guidance with traceable feedback', async () => {
  const record = await recordLearningInference({
    statement: `Useful rule ${suffix}`, confidence: 0.5, supportingEvidence: [evidence(12)], sourceWorker: 'discover'
  });
  const priorConfidence = record.payload.confidence;
  const updated = await evaluatePastGuidance(record.id, GUIDANCE_EVALUATIONS.USEFUL, { evidenceRef: evidence(13) });
  assert.ok(updated.payload.confidence > priorConfidence);
  assert.equal(updated.payload.supportingEvidence.length, 2);
  assert.equal(updated.payload.evaluationHistory.at(-1).evaluation, GUIDANCE_EVALUATIONS.USEFUL);
});

test('contradictory evidence downgrades then retires durable guidance', async () => {
  const record = await recordLearningInference({
    statement: `Contradicted rule ${suffix}`,
    classification: LEARNING_CLASSIFICATIONS.DURABLE_RULE,
    confidence: 0.9,
    supportingEvidence: [evidence(14), evidence(15), evidence(16)],
    sourceWorker: 'execute', hardFilter: true
  });
  const downgraded = await evaluatePastGuidance(record.id, GUIDANCE_EVALUATIONS.MISLEADING, { evidenceRef: evidence(17) });
  assert.equal(downgraded.payload.classification, LEARNING_CLASSIFICATIONS.TEMPORARY_HINT);
  assert.equal(downgraded.payload.hardFilter, false);
  const retired = await evaluatePastGuidance(record.id, GUIDANCE_EVALUATIONS.MISLEADING, { evidenceRef: evidence(18) });
  assert.equal(retired.status, 'RETIRED');
});

test('expired and retired guidance is excluded from active learning', async () => {
  await recordLearningInference({
    statement: `Expired hint ${suffix}`, confidence: 0.5, supportingEvidence: [evidence(19)],
    sourceWorker: 'discover', expiresAt: '2026-01-01T00:00:00Z'
  });
  const active = await listActiveLearning({ now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(active.some(record => record.payload.statement === `Expired hint ${suffix}`), false);
  assert.equal(active.some(record => record.status === 'RETIRED'), false);
});

test('Discover consumes active durable source filters and reports the applied rule', async () => {
  const source = `learned-source-${suffix}`;
  const rule = await recordLearningInference({
    statement: `Quarantine ${source}`,
    classification: LEARNING_CLASSIFICATIONS.DURABLE_RULE,
    confidence: 0.95,
    supportingEvidence: [evidence(20), evidence(21), evidence(22)],
    sourceWorker: 'validate',
    scope: `source:${source}`,
    hardFilter: true
  });
  const result = await runDiscoverWorker({
    sources: [],
    sampleCandidates: [{
      candidateId: `filtered-${suffix}`,
      noveltyKey: `filtered-${suffix}`,
      sourceType: source,
      title: 'Filtered by durable evidence'
    }],
    capabilityOptions: { env: {}, providers: [], rails: [] }
  });
  assert.equal(result.hardFiltered, 1);
  assert.equal(result.enqueued, 0);
  assert.ok(result.appliedLearningIds.includes(rule.id));
});
