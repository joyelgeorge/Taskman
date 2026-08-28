import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExecutionGate } from '../src/rails/execution-gate.js';
import { TaskForceRail } from '../src/rails/taskforce.js';

test('execution gate fails closed when a hard gate is missing', () => {
  const result = evaluateExecutionGate({
    payerVerified: true,
    taskOpen: true,
    acceptanceCriteriaClear: true,
    deliveryPathExecutable: true,
    noContradictoryInstructions: true,
    payoutPathExecutable: true,
    noRecurringManualStep: true,
    noUpfrontSpend: true,
    noUnsupportedSigning: false,
    payout: 1
  });
  assert.equal(result.passed, false);
  assert.ok(result.failed.includes('noUnsupportedSigning'));
});

test('execution gate passes only when every hard gate passes', () => {
  const result = evaluateExecutionGate({
    payerVerified: true,
    taskOpen: true,
    acceptanceCriteriaClear: true,
    deliveryPathExecutable: true,
    noContradictoryInstructions: true,
    payoutPathExecutable: true,
    noRecurringManualStep: true,
    noUpfrontSpend: true,
    noUnsupportedSigning: true,
    payout: 1,
    acceptanceProbability: 0.8,
    settlementProbability: 0.9,
    executionFriction: 1
  });
  assert.equal(result.passed, true);
  assert.equal(result.decision, 'EXECUTABLE');
  assert.equal(result.expectedValue, 0.72);
});

test('TaskForce defaults to read-only and blocks execution', async () => {
  const rail = new TaskForceRail({ apiKey: 'test-key' });
  assert.equal(rail.mode, 'read_only');
  await assert.rejects(() => rail.claimOrApply('123'), /blocked while rail is read-only/);
});
