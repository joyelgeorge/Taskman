import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  normalizeCandidate,
  qualifyCandidate,
  missingCapabilities
} from '../src/qualification-engine.js';
import {
  resolveQueueName,
  CANONICAL_QUEUES,
  QUALIFICATION_PROFILES
} from '../src/orchestration-profiles.js';

const capabilityOptions = { env: {}, providers: [], rails: [] };

function passingEvidence(profileName, prefix = 'https://evidence.example') {
  const gates = QUALIFICATION_PROFILES[profileName].evidenceGates;
  const evidence = gates.map(gate => `${prefix}/${gate}`);
  return {
    evidence,
    gateEvidence: Object.fromEntries(gates.map((gate, index) => [gate, {
      verdict: 'pass',
      evidenceRef: evidence[index]
    }]))
  };
}

const moneyMetrics = {
  flowScale: 1, recurrence: 1, triggerIndependence: 1, permission: 1,
  deltaMeasurability: 1, monetization: 1, executionAutonomy: 1,
  competitiveWhitespace: 1, setupBurden: 0, timeToMoney: 1
};

const bountyMetrics = {
  payoutCertainty: 1, acceptanceClarity: 1, executionAutonomy: 1,
  reusableRail: 1, setupBurden: 0, timeToMoney: 1, competitionRisk: 0
};

const incomeMetrics = {
  payerExists: 1, payoutCertainty: 1, submissionPath: 1,
  executionAutonomy: 1, reusableRail: 1, setupBurden: 0, timeToMoney: 1
};

test('normalizes candidates from multiple discovery source shapes', () => {
  const candidate = normalizeCandidate({
    id: 'x', source_type: 'bounty', name: 'Example', novelty_key: 'n1',
    scores: { payoutCertainty: 1 }, requiredCapabilities: ['github.write'],
    acceptance_criteria: 'Return JSON', gateEvidence: { payer_reward: { verdict: 'pass' } }
  });
  assert.equal(candidate.candidateId, 'x');
  assert.equal(candidate.sourceType, 'bounty');
  assert.equal(candidate.title, 'Example');
  assert.equal(candidate.noveltyKey, 'n1');
  assert.equal(candidate.acceptanceCriteria, 'Return JSON');
});

test('all eight money-flow gates require bound evidence', () => {
  const evidence = passingEvidence('programmable_money_flow_v1');
  const result = qualifyCandidate({ metrics: moneyMetrics, ...evidence },
    'programmable_money_flow_v1', { capabilityOptions });
  assert.equal(result.passes, true);
  assert.equal(result.recommendedStatus, 'THRESHOLD_CROSSED');
  assert.deepEqual(result.hardGateFailures, []);
  assert.deepEqual(result.evidence.missingGates, []);

  const lastGate = QUALIFICATION_PROFILES.programmable_money_flow_v1.evidenceGates.at(-1);
  const missing = qualifyCandidate({
    metrics: moneyMetrics,
    evidence: evidence.evidence,
    gateEvidence: { ...evidence.gateEvidence, [lastGate]: { verdict: 'pass', evidenceRef: '' } }
  }, 'programmable_money_flow_v1', { capabilityOptions });
  assert.equal(missing.passes, false);
  assert.equal(missing.recommendedStatus, 'NEEDS_EVIDENCE');
  assert.deepEqual(missing.evidence.missingGates, [lastGate]);

  const stale = qualifyCandidate({
    metrics: moneyMetrics,
    evidence: evidence.evidence,
    gateEvidence: {
      ...evidence.gateEvidence,
      [lastGate]: { ...evidence.gateEvidence[lastGate], stale: true }
    }
  }, 'programmable_money_flow_v1', { capabilityOptions });
  assert.equal(stale.recommendedStatus, 'NEEDS_EVIDENCE');
  assert.equal(stale.evidence.gateResults[lastGate].verdict, 'stale');
});

test('model confidence cannot override a failed deterministic hard gate', () => {
  const result = qualifyCandidate({
    confidence: 1,
    metrics: { ...moneyMetrics, flowScale: 0.2 },
    ...passingEvidence('programmable_money_flow_v1')
  }, 'programmable_money_flow_v1', { capabilityOptions });
  assert.equal(result.passes, false);
  assert.equal(result.recommendedStatus, 'REJECTED');
  assert.deepEqual(result.hardGateFailures, ['flowScale']);
});

test('a high-reward bounty without claim-risk and payout evidence is not executable', () => {
  const result = qualifyCandidate({
    estimatedValue: 100000,
    confidence: 1,
    metrics: bountyMetrics,
    evidence: ['https://bounty.example/reward']
  }, 'bounty_execution_v1', { capabilityOptions });
  assert.equal(result.passes, false);
  assert.equal(result.recommendedStatus, 'NEEDS_EVIDENCE');
  assert.ok(result.evidence.missingGates.includes('claim_risk'));
  assert.ok(result.evidence.missingGates.includes('payout_path'));
});

test('fully evidenced bounty reports one-time capability setup separately', () => {
  const result = qualifyCandidate({
    metrics: bountyMetrics,
    requiredCapabilities: ['moltjobs.authenticated'],
    ...passingEvidence('bounty_execution_v1')
  }, 'bounty_execution_v1', { capabilityOptions });
  assert.equal(result.passes, false);
  assert.equal(result.recommendedStatus, 'SETUP_REQUIRED');
  assert.equal(result.setupState, 'SETUP_REQUIRED');
  assert.deepEqual(result.capabilities.setupRequired, ['moltjobs.authenticated']);
});

test('unsupported recurring manual work rejects immediate-income execution', () => {
  const evidence = passingEvidence('immediate_income_v1');
  const manualGate = 'no_recurring_manual_work';
  const result = qualifyCandidate({
    metrics: incomeMetrics,
    evidence: evidence.evidence,
    gateEvidence: {
      ...evidence.gateEvidence,
      [manualGate]: { verdict: 'fail', evidenceRef: evidence.gateEvidence[manualGate].evidenceRef }
    }
  }, 'immediate_income_v1', { capabilityOptions });
  assert.equal(result.passes, false);
  assert.equal(result.recommendedStatus, 'REJECTED');
  assert.deepEqual(result.evidence.failedGates, [manualGate]);
});

test('an absent runtime adapter is BLOCKED rather than setup-ready', () => {
  const result = qualifyCandidate({
    metrics: bountyMetrics,
    requiredCapabilities: ['github.write'],
    ...passingEvidence('bounty_execution_v1')
  }, 'bounty_execution_v1', {
    capabilityOptions: { env: { GITHUB_TOKEN: 'present' }, providers: [], rails: [] }
  });
  assert.equal(result.recommendedStatus, 'BLOCKED');
  assert.equal(result.setupState, 'BLOCKED');
  assert.deepEqual(result.capabilities.unavailable, ['github.write']);
});

test('API and in-process qualification return equivalent decisions', async (t) => {
  const port = 34_000 + (process.pid % 10_000);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: '',
      TASKMAN_INTERNAL_SCHEDULER_ENABLED: 'false',
      TASKMAN_BRAIN_INTERVAL_MINUTES: '0'
    },
    stdio: 'ignore'
  });
  t.after(() => child.kill('SIGTERM'));

  const candidate = normalizeCandidate({
    candidateId: 'api-equivalence',
    profile: 'programmable_money_flow_v1',
    metrics: moneyMetrics,
    ...passingEvidence('programmable_money_flow_v1')
  });
  const expected = qualifyCandidate(candidate, candidate.profile);
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const response = await fetch(`${base}/api/qualification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ candidate })
  });
  assert.equal(response.status, 200);
  const actual = await response.json();
  assert.deepEqual(actual.qualification, expected);
});

test('reports missing reusable execution capabilities for legacy callers', () => {
  const candidate = normalizeCandidate({ requiredCapabilities: ['github.write', 'moltjobs.authenticated'] });
  assert.deepEqual(missingCapabilities(candidate, { 'github.write': true }), ['moltjobs.authenticated']);
});

test('legacy revenue queues resolve to canonical pipeline queues', () => {
  assert.equal(resolveQueueName('revenue_exploration_queue'), CANONICAL_QUEUES.candidates);
  assert.equal(resolveQueueName('revenue_scan_inference'), CANONICAL_QUEUES.inference);
});
