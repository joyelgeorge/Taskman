import test from 'node:test';
import assert from 'node:assert/strict';
import { ReasoningEngine } from '../src/reasoning-engine.js';
import { validateSchema } from '../src/reasoning-schemas.js';
import { runDiscoverWorker } from '../src/workers/discover.js';
import { runValidateWorker } from '../src/workers/validate.js';
import { runExecuteWorker } from '../src/workers/execute.js';
import { CANONICAL_QUEUES } from '../src/orchestration-profiles.js';
import { upsertRevenueRecord, listRevenueRecords } from '../src/revenue-store.js';

test('AI Reasoning Engine: validates discovery_synthesis schema strictly', () => {
  const validData = {
    candidates: [{
      title: 'Cloud Support Right-Sizing',
      noveltyKey: 'nov-1',
      profile: 'programmable_money_flow_v1',
      evidence: ['https://aws.amazon.com']
    }]
  };
  assert.equal(validateSchema(validData, 'discovery_synthesis').valid, true);

  const invalidData = { candidates: [{ title: 'No Evidence' }] };
  assert.equal(validateSchema(invalidData, 'discovery_synthesis').valid, false);
});

test('AI Reasoning Engine: returns parsed output through mock provider', async () => {
  const engine = new ReasoningEngine();
  const mock = async () => JSON.stringify({
    candidates: [{
      candidateId: 'cand-ai-1',
      title: 'AI Synthesized Real Opportunity',
      noveltyKey: 'ai-nov-1',
      profile: 'programmable_money_flow_v1',
      metrics: { flowScale: 1, recurrence: 1, triggerIndependence: 1, permission: 1, deltaMeasurability: 1, monetization: 1, executionAutonomy: 1, competitiveWhitespace: 1, setupBurden: 0, timeToMoney: 1 },
      evidence: ['https://aws.amazon.com/support/pricing/']
    }]
  });

  const res = await engine.synthesizeDiscovery({
    sourceEvidence: [{ raw: 'AWS Support Plan leakage data' }],
    mockProvider: mock
  });

  assert.equal(res.ok, true);
  assert.equal(res.data.candidates.length, 1);
  assert.equal(res.data.candidates[0].title, 'AI Synthesized Real Opportunity');
});

test('AI Reasoning Engine: handles malformed JSON output safely', async () => {
  const engine = new ReasoningEngine();
  const mock = async () => 'Not valid JSON at all';
  const res = await engine.reason({ prompt: 'test', mockProvider: mock });
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('not valid JSON'));
});

test('Discover Worker: AI synthesis enqueues valid opportunities into candidate_queue', async () => {
  const mockAi = async () => JSON.stringify({
    candidates: [{
      candidateId: 'cand-disc-ai-1',
      title: 'Valid AI Candidate',
      noveltyKey: `ai-cand-${crypto.randomUUID()}`,
      profile: 'programmable_money_flow_v1',
      metrics: { flowScale: 1, recurrence: 1, triggerIndependence: 1, permission: 1, deltaMeasurability: 1, monetization: 1, executionAutonomy: 1, competitiveWhitespace: 1, setupBurden: 0, timeToMoney: 1 },
      evidence: ['https://aws.amazon.com/support/plans/']
    }]
  });

  const discRes = await runDiscoverWorker({
    sampleCandidates: [{ id: 'src-1', title: 'Source Input' }],
    mockAiReasoning: mockAi
  });

  assert.equal(discRes.status, 'COMPLETED');
  assert.ok(discRes.enqueued >= 1);
});

test('Validate Worker: AI adversarial gate evaluation', async () => {
  const noveltyKey = `ai-val-${crypto.randomUUID()}`;
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.candidates,
    noveltyKey,
    status: 'NEW',
    priority: 90,
    payload: {
      candidate: {
        candidateId: 'val-ai-cand-1',
        title: 'Adversarial Test Candidate',
        noveltyKey,
        profile: 'programmable_money_flow_v1',
        evidence: ['https://aws.amazon.com/support/plans/'],
        metrics: { flowScale: 1, recurrence: 1, triggerIndependence: 1, permission: 1, deltaMeasurability: 1, monetization: 1, executionAutonomy: 1, competitiveWhitespace: 1, setupBurden: 0, timeToMoney: 1 }
      }
    }
  });

  const mockAi = async () => JSON.stringify({
    adversarialRisks: ['competitor lock-in'],
    gateEvidence: {
      money_flow_scale: { verdict: 'pass', evidenceRef: 'https://aws.amazon.com/1' },
      recurring_leakage: { verdict: 'pass', evidenceRef: 'https://aws.amazon.com/2' },
      independent_trigger: { verdict: 'pass', evidenceRef: 'https://aws.amazon.com/3' },
      permission_non_invasive: { verdict: 'pass', evidenceRef: 'https://aws.amazon.com/4' },
      measurable_delta: { verdict: 'pass', evidenceRef: 'https://aws.amazon.com/5' },
      monetization: { verdict: 'pass', evidenceRef: 'https://aws.amazon.com/6' },
      no_transaction_ownership: { verdict: 'pass', evidenceRef: 'https://aws.amazon.com/7' },
      competitive_whitespace: { verdict: 'pass', evidenceRef: 'https://aws.amazon.com/8' }
    }
  });

  const valRes = await runValidateWorker({ limit: 5, mockAiReasoning: mockAi });
  assert.ok(valRes.promotedCount >= 1);
});

test('Execute Worker: AI plan passes through to authorized executor function', async () => {
  const noveltyKey = `ai-exec-${crypto.randomUUID()}`;
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.execution,
    noveltyKey,
    status: 'NEW',
    priority: 95,
    payload: {
      candidate: {
        candidateId: 'exec-ai-cand-1',
        title: 'AI Plan Execution Task',
        noveltyKey,
        requiredCapabilities: []
      },
      classification: 'EXECUTABLE',
      missingCapabilities: []
    }
  });

  let receivedPlan = null;
  const mockPlan = async () => JSON.stringify({
    actionSummary: 'Execute optimized support right-sizing API call',
    requiredAdapters: ['aws_support_adapter'],
    steps: [{ order: 1, action: 'Query metrics', capability: 'web.read' }]
  });

  const execRes = await runExecuteWorker({
    limit: 5,
    mockAiReasoning: mockPlan,
    executorFn: async (cand, caps, plan) => {
      receivedPlan = plan;
      return { status: 'MONEY_EVENT', verifiedAttributableValue: 50, reason: 'AI plan executed successfully' };
    }
  });

  assert.equal(execRes.outcomesCount >= 1, true);
  assert.ok(receivedPlan);
  assert.equal(receivedPlan.actionSummary, 'Execute optimized support right-sizing API call');
});
