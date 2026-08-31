import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITY_ACCESS,
  CAPABILITY_STATUS,
  buildCapabilityRegistry,
  evaluateRequiredCapabilities,
  getRuntimeCapabilityMap,
  getSafeCapabilitySnapshot,
  registerCapability,
  unregisterCapability
} from '../src/capability-registry.js';
import { CANONICAL_QUEUES } from '../src/orchestration-profiles.js';
import { listRevenueRecords, upsertRevenueRecord } from '../src/revenue-store.js';
import { runDiscoverWorker } from '../src/workers/discover.js';
import { runValidateWorker } from '../src/workers/validate.js';
import { runExecuteWorker } from '../src/workers/execute.js';

const noProviders = [];
const noRails = [];

test('registry reports runtime truth and fails closed for missing adapters', () => {
  const capabilities = buildCapabilityRegistry({ env: {}, providers: noProviders, rails: noRails });
  assert.equal(capabilities['taskman.queue.read'].status, CAPABILITY_STATUS.AVAILABLE);
  assert.equal(capabilities['github.read'].status, CAPABILITY_STATUS.UNAVAILABLE);
  assert.equal(capabilities['github.write'].status, CAPABILITY_STATUS.UNAVAILABLE);
  assert.equal(capabilities['gmail.send'].status, CAPABILITY_STATUS.UNAVAILABLE);
  assert.equal(capabilities['moltjobs.authenticated'].status, CAPABILITY_STATUS.SETUP_REQUIRED);
  assert.equal(capabilities['wallet.sign'].status, CAPABILITY_STATUS.UNAVAILABLE);
});

test('credentials configure only installed adapters and are never exposed', () => {
  const secret = 'not-for-output';
  const snapshot = getSafeCapabilitySnapshot({
    env: { GITHUB_TOKEN: secret, MOLTJOBS_API_KEY: secret },
    providers: [{ id: 'mock', ready: true }],
    rails: noRails
  });
  assert.equal(snapshot.capabilities['github.write'].status, CAPABILITY_STATUS.UNAVAILABLE);
  assert.equal(snapshot.capabilities['moltjobs.authenticated'].status, CAPABILITY_STATUS.AVAILABLE);
  assert.equal(snapshot.capabilities['ai.provider.mock.available'].status, CAPABILITY_STATUS.AVAILABLE);
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
});

test('provider health can mark configured capability unhealthy', () => {
  const capabilities = buildCapabilityRegistry({
    env: {},
    providers: [{ id: 'mock', ready: true }],
    rails: noRails,
    health: {
      'ai.provider.mock.available': {
        status: CAPABILITY_STATUS.UNHEALTHY,
        reason: 'health_check_failed',
        lastHealthCheck: '2026-08-31T00:00:00.000Z'
      }
    }
  });
  assert.equal(capabilities['ai.provider.mock.available'].status, CAPABILITY_STATUS.UNHEALTHY);
});

test('custom capability metadata is allowlisted', () => {
  assert.throws(() => registerCapability('unsafe.read', {
    status: CAPABILITY_STATUS.AVAILABLE,
    access: CAPABILITY_ACCESS.READ,
    token: 'secret'
  }), /unsafe capability metadata/);

  registerCapability('custom.read', {
    status: CAPABILITY_STATUS.AVAILABLE,
    access: CAPABILITY_ACCESS.READ,
    adapter: 'test-adapter',
    reason: 'test'
  });
  const capabilities = buildCapabilityRegistry({ env: {}, providers: noProviders, rails: noRails });
  assert.equal(capabilities['custom.read'].status, CAPABILITY_STATUS.AVAILABLE);
  unregisterCapability('custom.read');
});

test('required capability evaluation distinguishes setup from hard blocking', () => {
  const result = evaluateRequiredCapabilities([
    'taskman.queue.read', 'moltjobs.authenticated', 'github.write', 'missing.unknown'
  ], { env: {}, providers: noProviders, rails: noRails });
  assert.deepEqual(result.available, ['taskman.queue.read']);
  assert.deepEqual(result.setupRequired, ['moltjobs.authenticated']);
  assert.deepEqual(result.unavailable, ['github.write', 'missing.unknown']);
});

test('Discover records missing capability state without hiding setup opportunities', async () => {
  const noveltyKey = `cap-discover-${crypto.randomUUID()}`;
  const result = await runDiscoverWorker({
    sources: [],
    sampleCandidates: [{
      candidateId: noveltyKey,
      noveltyKey,
      title: 'Capability setup opportunity',
      profile: 'programmable_money_flow_v1',
      requiredCapabilities: ['github.write'],
      metrics: {
        flowScale: 1, recurrence: 1, triggerIndependence: 1, permission: 1,
        deltaMeasurability: 1, monetization: 1, executionAutonomy: 1,
        competitiveWhitespace: 1, setupBurden: 0, timeToMoney: 1
      }
    }],
    capabilityOptions: { env: {}, providers: noProviders, rails: noRails }
  });
  assert.equal(result.enqueued, 1);
  assert.deepEqual(result.enqueuedRecords[0].payload.missingCapabilities, ['github.write']);
});

test('Validate classifies evidence-passing work as setup required when runtime capability is absent', async () => {
  const noveltyKey = `cap-validate-${crypto.randomUUID()}`;
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.candidates,
    noveltyKey,
    status: 'NEW',
    priority: 90,
    payload: { candidate: {
      candidateId: noveltyKey,
      noveltyKey,
      title: 'Configured payout job',
      profile: 'bounty_execution_v1',
      estimatedValue: 10,
      acceptanceCriteria: 'Return JSON',
      evidence: ['https://example.com/bounty/escrow'],
      requiredCapabilities: ['moltjobs.authenticated'],
      metrics: {
        payoutCertainty: 1, acceptanceClarity: 1, executionAutonomy: 1,
        reusableRail: 1, setupBurden: 0, timeToMoney: 1, competitionRisk: 0
      }
    } }
  });
  const result = await runValidateWorker({
    capabilityOptions: { env: {}, providers: noProviders, rails: noRails }
  });
  assert.equal(result.promotedCount, 1);
  assert.equal(result.promotedRecords[0].payload.classification, 'SETUP_REQUIRED');
});

test('Execute recomputes current capability state and blocks an unavailable write adapter', async () => {
  const noveltyKey = `cap-execute-${crypto.randomUUID()}`;
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.execution,
    noveltyKey,
    status: 'NEW',
    priority: 99,
    payload: { candidate: {
      candidateId: noveltyKey,
      noveltyKey,
      title: 'GitHub mutation',
      requiredCapabilities: ['github.write']
    }, missingCapabilities: [] }
  });
  let called = false;
  const result = await runExecuteWorker({
    executorFn: async () => { called = true; return { status: 'COMPLETED' }; },
    capabilityOptions: { env: { GITHUB_TOKEN: 'present' }, providers: noProviders, rails: noRails }
  });
  assert.equal(called, false);
  assert.equal(result.outcomes[0].status, 'BLOCKED');
  assert.equal(result.outcomes[0].payload.attributableValue, 0);
});

test('runtime map exposes booleans for compatibility without accepting caller assertions', () => {
  const map = getRuntimeCapabilityMap({ env: {}, providers: noProviders, rails: noRails });
  assert.equal(map['taskman.queue.read'], true);
  assert.equal(map['github.write'], false);
});
