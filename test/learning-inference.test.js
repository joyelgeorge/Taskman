import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordLearningInference,
  listActiveInferences,
  evaluatePastGuidance,
  INFERENCE_CLASSIFICATION,
  GUIDANCE_EVALUATION
} from '../src/learning-inference.js';

test('Learning Inference: records TEMPORARY_HINT on single/low confidence evidence', async () => {
  const result = await recordLearningInference({
    statement: 'Single failure observed on sample source',
    classification: INFERENCE_CLASSIFICATION.DURABLE_RULE, // requested durable but lacking evidence
    confidence: 0.6,
    evidenceCount: 1,
    supportingEvidence: ['https://example.com/item1'],
    sourceWorker: 'discover',
    noveltyKey: `test-hint-${crypto.randomUUID()}`
  });

  assert.equal(result.payload.classification, INFERENCE_CLASSIFICATION.TEMPORARY_HINT);
});

test('Learning Inference: promotes to DURABLE_RULE with high confidence and multiple evidence points', async () => {
  const noveltyKey = `test-durable-${crypto.randomUUID()}`;
  const result = await recordLearningInference({
    statement: 'Repeated API permission blocker',
    classification: INFERENCE_CLASSIFICATION.DURABLE_RULE,
    confidence: 0.9,
    evidenceCount: 3,
    supportingEvidence: ['https://example.com/err1', 'https://example.com/err2'],
    sourceWorker: 'validate',
    noveltyKey
  });

  assert.equal(result.payload.classification, INFERENCE_CLASSIFICATION.DURABLE_RULE);
});

test('Learning Inference: self-corrects and downgrades misleading guidance', async () => {
  const noveltyKey = `test-misleading-${crypto.randomUUID()}`;
  await recordLearningInference({
    statement: 'Prematurely assumed rate limit',
    classification: INFERENCE_CLASSIFICATION.DURABLE_RULE,
    confidence: 0.9,
    evidenceCount: 2,
    supportingEvidence: ['ref1', 'ref2'],
    sourceWorker: 'discover',
    noveltyKey
  });

  const updated = await evaluatePastGuidance(noveltyKey, GUIDANCE_EVALUATION.MISLEADING, 'Successful retry proved rate limit was transient');
  assert.equal(updated.payload.classification, INFERENCE_CLASSIFICATION.TEMPORARY_HINT);
  assert.ok(updated.payload.confidence < 0.9);
});
