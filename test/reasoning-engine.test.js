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
  assert.equal(res.error, 'MODEL_OUTPUT_INVALID');
  assert.equal('rawText' in res, false);
});

test('Discover Worker: never calls a model, even when one is offered', async () => {
  // Discovery is deterministic by contract (docs/TARGET_DESIGN.md §1): a model may
  // transform an existing candidate, never originate one. runDiscoverWorker no
  // longer accepts mockAiReasoning at all — passing it is simply ignored — and a
  // sample candidate with no evidence must qualify or fail on its own merits.
  let called = false;
  const trackedAi = async () => { called = true; return '{"candidates":[]}'; };

  const discRes = await runDiscoverWorker({
    sampleCandidates: [{
      id: 'src-1',
      title: 'Source Input',
      noveltyKey: `no-ai-${crypto.randomUUID()}`,
      profile: 'programmable_money_flow_v1',
      metrics: { flowScale: 1, recurrence: 1, triggerIndependence: 1, permission: 1, deltaMeasurability: 1, monetization: 1, executionAutonomy: 1, competitiveWhitespace: 1, setupBurden: 0, timeToMoney: 1 },
      evidence: ['https://aws.amazon.com/support/plans/']
    }],
    mockAiReasoning: trackedAi
  });

  assert.equal(called, false, 'discovery must never invoke a model, even one supplied by the caller');
  assert.equal(discRes.status, 'COMPLETED');
  assert.ok(discRes.enqueued >= 1, 'the explicit sample candidate should still qualify deterministically');
});

test('Discover Worker: reports zero candidates loudly rather than staying silent', async () => {
  const discRes = await runDiscoverWorker({ sources: ['recent_events'], sampleCandidates: [] });
  assert.equal(discRes.zeroCandidates, true);
  assert.equal(discRes.enqueued, 0);
  assert.deepEqual(discRes.sourcesQueried, ['recent_events']);
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
        evidence: Array.from({ length: 8 }, (_, index) => `https://aws.amazon.com/${index + 1}`),
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
  // taskman.queue.read is the one capability capability-registry.js marks
  // AVAILABLE unconditionally; web.read is UNAVAILABLE by default (no runtime
  // adapter installed), so a plan naming it is correctly rejected by
  // src/transforms/execution-plan.js's post-condition — see docs/SYSTEM_DESIGN.md §13.
  const mockPlan = async () => JSON.stringify({
    actionSummary: 'Execute optimized support right-sizing API call',
    requiredAdapters: ['aws_support_adapter'],
    steps: [{ order: 1, action: 'Query metrics', capability: 'taskman.queue.read' }]
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
