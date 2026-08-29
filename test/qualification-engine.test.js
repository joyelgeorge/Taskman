import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandidate, qualifyCandidate, missingCapabilities } from '../src/qualification-engine.js';
import { resolveQueueName, CANONICAL_QUEUES } from '../src/orchestration-profiles.js';

test('normalizes candidates from multiple discovery source shapes', () => {
  const candidate = normalizeCandidate({
    id: 'x', source_type: 'bounty', name: 'Example', novelty_key: 'n1',
    scores: { payoutCertainty: 1 }, requiredCapabilities: ['github.write']
  });
  assert.equal(candidate.candidateId, 'x');
  assert.equal(candidate.sourceType, 'bounty');
  assert.equal(candidate.title, 'Example');
  assert.equal(candidate.noveltyKey, 'n1');
});

test('qualification profiles apply hard gates', () => {
  const candidate = normalizeCandidate({ metrics: {
    flowScale: 1, recurrence: 1, triggerIndependence: 1, permission: 1,
    deltaMeasurability: 1, monetization: 1, executionAutonomy: 1,
    competitiveWhitespace: 1, setupBurden: 0, timeToMoney: 1
  }});
  const result = qualifyCandidate(candidate, 'programmable_money_flow_v1');
  assert.equal(result.passes, true);
  assert.deepEqual(result.hardGateFailures, []);
});

test('qualification profiles: bounty_execution_v1 evaluates properly', () => {
  const candidate = normalizeCandidate({
    metrics: { payoutCertainty: 1, acceptanceClarity: 1, executionAutonomy: 1, reusableRail: 1, timeToMoney: 1, competitionRisk: 0 },
    evidence: ['https://bounties.example/1']
  });
  const result = qualifyCandidate(candidate, 'bounty_execution_v1');
  assert.equal(result.passes, true);
  assert.equal(result.recommendedStatus, 'EXECUTABLE');
});

test('qualification profiles: immediate_income_v1 evaluates properly', () => {
  const candidate = normalizeCandidate({
    metrics: { payerExists: 1, payoutCertainty: 1, submissionPath: 1, executionAutonomy: 1, reusableRail: 1, timeToMoney: 1 },
    evidence: ['https://work.example/2']
  });
  const result = qualifyCandidate(candidate, 'immediate_income_v1');
  assert.equal(result.passes, true);
  assert.equal(result.recommendedStatus, 'EXECUTABLE');
});

test('qualification profiles: hard-gate failure fails qualification', () => {
  const candidate = normalizeCandidate({
    metrics: { flowScale: 0.2, recurrence: 1, triggerIndependence: 1, permission: 1, deltaMeasurability: 1, monetization: 1, executionAutonomy: 1, competitiveWhitespace: 1 },
    evidence: ['https://example.com/flow']
  });
  const result = qualifyCandidate(candidate, 'programmable_money_flow_v1');
  assert.equal(result.passes, false);
  assert.deepEqual(result.hardGateFailures, ['flowScale']);
  assert.equal(result.recommendedStatus, 'REJECTED');
});
