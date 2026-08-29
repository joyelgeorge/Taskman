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

test('reports missing reusable execution capabilities', () => {
  const candidate = normalizeCandidate({ requiredCapabilities: ['github.write', 'moltjobs.authenticated'] });
  assert.deepEqual(missingCapabilities(candidate, { 'github.write': true }), ['moltjobs.authenticated']);
});

test('legacy revenue queues resolve to canonical pipeline queues', () => {
  assert.equal(resolveQueueName('revenue_exploration_queue'), CANONICAL_QUEUES.candidates);
  assert.equal(resolveQueueName('revenue_scan_inference'), CANONICAL_QUEUES.inference);
});
