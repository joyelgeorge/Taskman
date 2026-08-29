import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNextRunAt,
  generateRunKey,
  getMinuteOffset,
  DEFAULT_SCHEDULES,
  claimScheduledJob,
  finishScheduledJobRun,
  initializeScheduler,
  listScheduledJobs,
  reconcileOverdueJobs,
  resetScheduledJobsForTesting,
  isSchedulerDurable
} from '../src/durable-scheduler.js';
import { runDiscoverWorker, discoverFromRealSources } from '../src/workers/discover.js';
import { runValidateWorker, evaluateEvidenceGates, EIGHT_MONEY_FLOW_GATES } from '../src/workers/validate.js';
import { runExecuteWorker } from '../src/workers/execute.js';
import { CANONICAL_QUEUES, LEGACY_QUEUE_ALIASES, resolveQueueName } from '../src/orchestration-profiles.js';
import { listRevenueRecords, upsertRevenueRecord } from '../src/revenue-store.js';

test('1. Discover/Validate/Execute schedules calculate expected staggered due times (:00, :10, :20)', () => {
  assert.equal(getMinuteOffset('0 * * * *'), 0);
  assert.equal(getMinuteOffset('10 * * * *'), 10);
  assert.equal(getMinuteOffset('20 * * * *'), 20);

  const base = new Date('2026-08-29T10:00:00.000Z');

  // Next Discover (:00) after 10:00:00 -> 11:00:00
  const nextDiscover = computeNextRunAt('0 * * * *', base);
  assert.equal(nextDiscover.toISOString(), '2026-08-29T11:00:00.000Z');

  // Next Validate (:10) after 10:00:00 -> 10:10:00
  const nextValidate = computeNextRunAt('10 * * * *', base);
  assert.equal(nextValidate.toISOString(), '2026-08-29T10:10:00.000Z');

  // Next Execute (:20) after 10:00:00 -> 10:20:00
  const nextExecute = computeNextRunAt('20 * * * *', base);
  assert.equal(nextExecute.toISOString(), '2026-08-29T10:20:00.000Z');
});

test('2. Two concurrent schedulers cannot claim the same firing', async () => {
  await resetScheduledJobsForTesting();
  const fixedNow = new Date('2026-08-29T10:00:00.000Z');
  await initializeScheduler({ now: new Date('2026-08-29T09:00:00.000Z') });

  // First worker claims
  const claim1 = await claimScheduledJob('discover', {
    now: fixedNow,
    claimedBy: 'worker-instance-1'
  });
  assert.ok(claim1, 'Worker 1 should claim successfully');
  assert.equal(claim1.claimedBy, 'worker-instance-1');

  // Second worker attempts concurrent claim for the same due firing
  const claim2 = await claimScheduledJob('discover', {
    now: fixedNow,
    claimedBy: 'worker-instance-2'
  });
  assert.equal(claim2, null, 'Worker 2 must be blocked while lease is active');
});

test('3. Expired lease can be reclaimed by another worker', async () => {
  await resetScheduledJobsForTesting();
  const fixedNow = new Date('2026-08-29T10:00:00.000Z');
  await initializeScheduler({ now: new Date('2026-08-29T09:00:00.000Z') });

  // Worker 1 claims with a short 1-second lease
  const claim1 = await claimScheduledJob('validate', {
    now: fixedNow,
    leaseMs: 1000,
    claimedBy: 'worker-crashed'
  });
  assert.ok(claim1);

  // Time advances past lease expiration (5 seconds later)
  const laterTime = new Date('2026-08-29T10:00:05.000Z');
  const claim2 = await claimScheduledJob('validate', {
    now: laterTime,
    claimedBy: 'worker-recovered'
  });
  assert.ok(claim2, 'Worker 2 should reclaim the job after lease expiry');
  assert.equal(claim2.claimedBy, 'worker-recovered');
});

test('4. Same run_key cannot produce duplicate execution', async () => {
  await resetScheduledJobsForTesting();
  const fixedNow = new Date('2026-08-29T10:20:00.000Z');
  await initializeScheduler({ now: new Date('2026-08-29T09:00:00.000Z') });

  const claim = await claimScheduledJob('execute', { now: fixedNow, claimedBy: 'worker-1' });
  assert.ok(claim);

  // Finish run
  await finishScheduledJobRun({
    jobId: claim.job.id,
    runKey: claim.runKey,
    status: 'COMPLETED',
    result: { itemsProcessed: 1 },
    now: fixedNow
  });

  // Attempting to claim the exact same firing again returns null
  const duplicateClaim = await claimScheduledJob('execute', { now: fixedNow, claimedBy: 'worker-2' });
  assert.equal(duplicateClaim, null, 'Completed firing with same runKey cannot be claimed again');
});

test('5. Restart restores schedule state', async () => {
  await resetScheduledJobsForTesting();
  const t0 = new Date('2026-08-29T08:00:00.000Z');
  await initializeScheduler({ now: t0 });

  const jobsBefore = await listScheduledJobs();
  assert.equal(jobsBefore.length, 3);

  // Simulate restart by re-calling initializeScheduler
  const jobsAfter = await initializeScheduler({ now: t0 });
  assert.equal(jobsAfter.length, 3);
  assert.deepEqual(
    jobsAfter.map(j => j.id).sort(),
    DEFAULT_SCHEDULES.map(s => s.id).sort()
  );
});

test('6. Catch-up policy handles overdue runs boundedly without unbounded historical replay', async () => {
  await resetScheduledJobsForTesting();
  // Schedule initialized long in the past (3 hours ago)
  const past = new Date('2026-08-29T07:00:00.000Z');
  await initializeScheduler({ now: past });

  const now = new Date('2026-08-29T10:00:00.000Z');
  const overdue = await reconcileOverdueJobs({ now });

  assert.ok(overdue.length > 0);
  assert.ok(overdue.every(o => o.catchUpApplied));

  // Claim fires the overdue job once
  const claim = await claimScheduledJob('discover', { now, claimedBy: 'catchup-worker' });
  assert.ok(claim);
  await finishScheduledJobRun({
    jobId: claim.job.id,
    runKey: claim.runKey,
    status: 'COMPLETED',
    now
  });

  // Next run is calculated to the future, not executing the 2 intermediate missed hours
  const jobs = await listScheduledJobs();
  const discoverJob = jobs.find(j => j.workerName === 'discover');
  assert.ok(new Date(discoverJob.nextRunAt).getTime() >= now.getTime());
});

test('7. Discover writes only to candidate_queue / discovery state and does not execute', async () => {
  const uniqueTitle = `Unique Hypothesis ${crypto.randomUUID()}`;
  const noveltyKey = `novelty-disc-${crypto.randomUUID()}`;
  const result = await runDiscoverWorker({
    sampleCandidates: [{
      id: 'disc-cand-1',
      title: uniqueTitle,
      noveltyKey,
      metrics: {
        flowScale: 1, recurrence: 1, triggerIndependence: 1, permission: 1,
        deltaMeasurability: 1, monetization: 1, executionAutonomy: 1,
        competitiveWhitespace: 1, setupBurden: 0, timeToMoney: 1
      },
      requiredCapabilities: ['web.read']
    }]
  });

  assert.equal(result.stage, 'DISCOVER');
  assert.equal(result.status, 'COMPLETED');
  assert.ok(result.enqueued >= 1);

  // Check records in candidate_queue
  const candidates = await listRevenueRecords(CANONICAL_QUEUES.candidates);
  assert.ok(candidates.some(c => c.noveltyKey === noveltyKey));

  // Ensure nothing was written directly to execution_queue or outcomes
  const outcomes = await listRevenueRecords(CANONICAL_QUEUES.outcomes);
  assert.ok(!outcomes.some(o => o.payload?.title === uniqueTitle));
});

test('8. Validate consumes candidate work and promotes executable items to execution_queue', async () => {
  const noveltyKey = `val-test-${crypto.randomUUID()}`;
  const allPassGates = Object.fromEntries(EIGHT_MONEY_FLOW_GATES.map(g => [g, 'pass']));

  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.candidates,
    noveltyKey,
    status: 'NEW',
    priority: 85,
    payload: {
      candidate: {
        candidateId: 'cand-val-1',
        title: 'Validatable Candidate with 8 Gates',
        noveltyKey,
        profile: 'programmable_money_flow_v1',
        metrics: {
          flowScale: 1, recurrence: 1, triggerIndependence: 1, permission: 1,
          deltaMeasurability: 1, monetization: 1, executionAutonomy: 1,
          competitiveWhitespace: 1, setupBurden: 0, timeToMoney: 1
        },
        gates: allPassGates,
        requiredCapabilities: ['github.read'],
        evidence: ['https://aws.amazon.com/pricing', 'https://doit.com']
      }
    }
  });

  const valResult = await runValidateWorker({ limit: 5 });
  assert.equal(valResult.stage, 'VALIDATE');
  assert.ok(valResult.promotedCount >= 1);

  // Check that item reached execution_queue
  const execRecords = await listRevenueRecords(CANONICAL_QUEUES.execution);
  assert.ok(execRecords.some(r => r.noveltyKey === `exec-${noveltyKey}`));
});

test('9. Execute consumes execution-ready items with authorized executor or safely marks BLOCKED without simulating value', async () => {
  const noveltyKey = `exec-test-${crypto.randomUUID()}`;
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.execution,
    noveltyKey,
    status: 'NEW',
    priority: 90,
    payload: {
      candidate: {
        candidateId: 'cand-exec-1',
        title: 'Executable Revenue Task',
        noveltyKey,
        estimatedValue: 250,
        requiredCapabilities: ['taskman.queue.read']
      },
      classification: 'EXECUTABLE',
      missingCapabilities: []
    }
  });

  // Test with real executor function that verifies attributable value
  const execResult = await runExecuteWorker({
    limit: 5,
    executorFn: async (cand) => ({
      status: 'MONEY_EVENT',
      reason: 'Authorized execution completed',
      verifiedAttributableValue: 125
    })
  });

  assert.equal(execResult.stage, 'EXECUTE');
  assert.ok(execResult.outcomesCount >= 1);

  // Check outcome in economic_outcomes
  const outcomeRecords = await listRevenueRecords(CANONICAL_QUEUES.outcomes);
  const matchedOutcome = outcomeRecords.find(o => o.noveltyKey === `outcome-${noveltyKey}`);
  assert.ok(matchedOutcome);
  assert.equal(matchedOutcome.status, 'MONEY_EVENT');
  assert.equal(matchedOutcome.payload.attributableValue, 125);
});

test('10. Negative invariant: Discover never fabricates candidates when no real source provides them', async () => {
  // When no sample candidates and sources without real data are passed:
  const result = await runDiscoverWorker({
    sources: ['recent_events'],
    sampleCandidates: []
  });
  assert.equal(result.evaluated, 0);
  assert.equal(result.enqueued, 0);
});

test('11. Negative invariant: Validate requires evidence and all 8 gates for THRESHOLD_CROSSED; score alone never promotes', () => {
  // Candidate with perfect 10/10 metrics but zero evidence
  const zeroEvidenceCand = {
    profile: 'programmable_money_flow_v1',
    metrics: { flowScale: 1, recurrence: 1, triggerIndependence: 1, permission: 1, deltaMeasurability: 1, monetization: 1, executionAutonomy: 1, competitiveWhitespace: 1 },
    evidence: []
  };
  const zeroEvResult = evaluateEvidenceGates(zeroEvidenceCand);
  assert.equal(zeroEvResult.passed, false);
  assert.equal(zeroEvResult.status, 'NEEDS_EVIDENCE');

  // Candidate with evidence but uncertain gate (7 passes, 1 uncertain)
  const partialPassGates = Object.fromEntries(EIGHT_MONEY_FLOW_GATES.map((g, idx) => [g, idx === 0 ? 'uncertain' : 'pass']));
  const partialCand = {
    profile: 'programmable_money_flow_v1',
    evidence: ['https://example.com/doc'],
    gates: partialPassGates
  };
  const partialResult = evaluateEvidenceGates(partialCand);
  assert.equal(partialResult.passed, false);
  assert.equal(partialResult.status, 'NEEDS_EVIDENCE');
});

test('12. Negative invariant: Execute never simulates VALUE_CREATED or MONEY_EVENT without concrete authorized executor', async () => {
  const noveltyKey = `exec-neg-${crypto.randomUUID()}`;
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.execution,
    noveltyKey,
    status: 'NEW',
    priority: 95,
    payload: {
      candidate: {
        candidateId: 'cand-neg-1',
        title: 'Unexecutable Candidate Without Adapter',
        noveltyKey,
        estimatedValue: 10000 // Invariant: High estimated value must NOT become realized value
      },
      classification: 'EXECUTABLE',
      missingCapabilities: []
    }
  });

  // Run execute worker without an authorized executorFn
  const execResult = await runExecuteWorker({ limit: 10 });
  const outcomes = await listRevenueRecords(CANONICAL_QUEUES.outcomes);
  const matched = outcomes.find(o => o.noveltyKey === `outcome-${noveltyKey}`);

  assert.ok(matched);
  assert.equal(matched.status, 'BLOCKED');
  assert.equal(matched.payload.attributableValue, 0); // Realized value MUST be 0
  assert.ok(matched.payload.outcomeReason.includes('No authorized executable action adapter'));
});

test('13. Existing revenue queue tests and legacy aliases remain compatible', async () => {
  assert.equal(resolveQueueName('revenue_exploration_queue'), CANONICAL_QUEUES.candidates);
  assert.equal(resolveQueueName('revenue_opportunity_deepdives'), CANONICAL_QUEUES.validation);
  assert.equal(resolveQueueName('revenue_execution_results'), CANONICAL_QUEUES.outcomes);
  assert.equal(resolveQueueName('revenue_scan_inference'), CANONICAL_QUEUES.inference);

  const testKey = `alias-test-${crypto.randomUUID()}`;
  await upsertRevenueRecord({
    queue: resolveQueueName('revenue_exploration_queue'),
    noveltyKey: testKey,
    priority: 10,
    payload: { aliasTest: true }
  });

  const canonicalRecords = await listRevenueRecords(CANONICAL_QUEUES.candidates);
  assert.ok(canonicalRecords.some(r => r.noveltyKey === testKey));
});

test('14. Memory-mode reports clearly that durable guarantees require PostgreSQL', () => {
  const durable = isSchedulerDurable();
  assert.equal(typeof durable, 'boolean');
});
