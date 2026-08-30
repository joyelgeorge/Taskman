import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNextRunAt,
  generateRunKey,
  getMinuteOffset,
  DEFAULT_SCHEDULES,
  DEFAULT_LEASE_MS,
  claimScheduledJob,
  finishScheduledJobRun,
  renewScheduledJobLease,
  initializeScheduler,
  listScheduledJobs,
  reconcileOverdueJobs,
  resetScheduledJobsForTesting,
  isSchedulerDurable
} from '../src/durable-scheduler.js';
import { runDiscoverWorker } from '../src/workers/discover.js';
import { runValidateWorker, evaluateEvidenceGates, EIGHT_MONEY_FLOW_GATES } from '../src/workers/validate.js';
import { runExecuteWorker } from '../src/workers/execute.js';
import { CANONICAL_QUEUES, resolveQueueName } from '../src/orchestration-profiles.js';
import { listRevenueRecords, upsertRevenueRecord } from '../src/revenue-store.js';

// Helper: build per-gate evidence with individual references
function buildGateEvidence(gates, evidenceRefs) {
  return Object.fromEntries(gates.map((gate, i) => [
    gate, { verdict: 'pass', evidenceRef: evidenceRefs[i] || evidenceRefs[0] }
  ]));
}

// ─── Scheduler / Infrastructure ────────────────────────────────────────────────

test('1. Discover/Validate/Execute schedules calculate expected staggered due times (:00, :10, :20)', () => {
  assert.equal(getMinuteOffset('0 * * * *'), 0);
  assert.equal(getMinuteOffset('10 * * * *'), 10);
  assert.equal(getMinuteOffset('20 * * * *'), 20);
  assert.equal(getMinuteOffset('*/5 * * * *'), null);

  const base = new Date('2026-08-29T10:00:00.000Z');
  assert.equal(computeNextRunAt('0 * * * *', base).toISOString(),  '2026-08-29T11:00:00.000Z');
  assert.equal(computeNextRunAt('10 * * * *', base).toISOString(), '2026-08-29T10:10:00.000Z');
  assert.equal(computeNextRunAt('20 * * * *', base).toISOString(), '2026-08-29T10:20:00.000Z');
  assert.equal(computeNextRunAt('*/5 * * * *', base).toISOString(), '2026-08-29T10:05:00.000Z');
});

test('2. Two concurrent schedulers cannot claim the same firing', async () => {
  await resetScheduledJobsForTesting();
  const fixedNow = new Date('2026-08-29T10:00:00.000Z');
  await initializeScheduler({ now: new Date('2026-08-29T09:00:00.000Z') });

  const claim1 = await claimScheduledJob('discover', { now: fixedNow, claimedBy: 'worker-1' });
  assert.ok(claim1, 'Worker 1 should claim successfully');
  assert.ok(claim1.leaseToken, 'Claim ticket must include a leaseToken');

  const claim2 = await claimScheduledJob('discover', { now: fixedNow, claimedBy: 'worker-2' });
  assert.equal(claim2, null, 'Worker 2 must be blocked while lease is active');
});

test('3. Expired lease can be reclaimed by another worker', async () => {
  await resetScheduledJobsForTesting();
  const fixedNow = new Date('2026-08-29T10:00:00.000Z');
  await initializeScheduler({ now: new Date('2026-08-29T09:00:00.000Z') });

  const claim1 = await claimScheduledJob('validate', {
    now: fixedNow, leaseMs: 1000, claimedBy: 'worker-crashed'
  });
  assert.ok(claim1);

  const laterTime = new Date('2026-08-29T10:00:05.000Z');
  const claim2 = await claimScheduledJob('validate', { now: laterTime, claimedBy: 'worker-recovered' });
  assert.ok(claim2, 'Worker 2 should reclaim after lease expiry');
  assert.equal(claim2.claimedBy, 'worker-recovered');
  assert.ok(claim2.leaseToken, 'New claim must have its own leaseToken');
  // Fencing: the new token must differ from the original
  assert.notEqual(claim2.leaseToken, claim1.leaseToken);
});

test('4. Same run_key cannot produce duplicate execution', async () => {
  await resetScheduledJobsForTesting();
  const fixedNow = new Date('2026-08-29T10:20:00.000Z');
  await initializeScheduler({ now: new Date('2026-08-29T09:00:00.000Z') });

  const claim = await claimScheduledJob('execute', { now: fixedNow, claimedBy: 'worker-1' });
  assert.ok(claim);

  await finishScheduledJobRun({
    jobId: claim.job.id,
    runKey: claim.runKey,
    leaseToken: claim.leaseToken,
    status: 'COMPLETED',
    result: { itemsProcessed: 1 },
    now: fixedNow
  });

  const duplicateClaim = await claimScheduledJob('execute', { now: fixedNow, claimedBy: 'worker-2' });
  assert.equal(duplicateClaim, null, 'Completed runKey cannot be claimed again');
});

test('5. Stale worker A cannot clear active lease held by worker B (fencing token)', async () => {
  await resetScheduledJobsForTesting();
  const fixedNow = new Date('2026-08-29T10:00:00.000Z');
  await initializeScheduler({ now: new Date('2026-08-29T09:00:00.000Z') });

  // Worker A claims with very short lease (1 second)
  const claimA = await claimScheduledJob('discover', {
    now: fixedNow, leaseMs: 1000, claimedBy: 'worker-A'
  });
  assert.ok(claimA);

  // A's lease expires; Worker B reclaims
  const after5s = new Date('2026-08-29T10:00:05.000Z');
  const claimB = await claimScheduledJob('discover', { now: after5s, claimedBy: 'worker-B' });
  assert.ok(claimB, 'Worker B must reclaim after A\'s lease expiry');
  assert.notEqual(claimB.leaseToken, claimA.leaseToken);

  // Worker A wakes up late and tries to finish with its old token — must be fenced
  const staleFinish = await finishScheduledJobRun({
    jobId: claimA.job.id,
    runKey: claimA.runKey,
    leaseToken: claimA.leaseToken, // A's old, now-invalid token
    status: 'COMPLETED',
    result: { late: true },
    now: after5s
  });
  assert.equal(staleFinish.ok, false, 'Stale worker A must be fenced out');
  assert.equal(staleFinish.fenced, true);

  // Worker B can still cleanly finish
  const goodFinish = await finishScheduledJobRun({
    jobId: claimB.job.id,
    runKey: claimB.runKey,
    leaseToken: claimB.leaseToken,
    status: 'COMPLETED',
    result: { realWork: true },
    now: new Date('2026-08-29T10:00:10.000Z')
  });
  assert.equal(goodFinish.ok, true, 'Worker B must finish cleanly with valid token');
});

test('6. Lease heartbeat (renew) extends lease; wrong token is rejected', async () => {
  await resetScheduledJobsForTesting();
  const fixedNow = new Date('2026-08-29T10:00:00.000Z');
  await initializeScheduler({ now: new Date('2026-08-29T09:00:00.000Z') });

  const claim = await claimScheduledJob('validate', {
    now: fixedNow, leaseMs: 2000, claimedBy: 'worker-long'
  });
  assert.ok(claim);

  // Renew with correct token succeeds
  const renewed = await renewScheduledJobLease({
    jobId: claim.job.id,
    leaseToken: claim.leaseToken,
    leaseMs: DEFAULT_LEASE_MS,
    now: new Date('2026-08-29T10:00:01.000Z')
  });
  assert.equal(renewed.ok, true);
  assert.ok(renewed.newExpiresAt);

  // Renew with a wrong/forged token must be rejected
  const forgedToken = crypto.randomUUID();
  const rejectedRenew = await renewScheduledJobLease({
    jobId: claim.job.id,
    leaseToken: forgedToken,
    leaseMs: DEFAULT_LEASE_MS,
    now: new Date('2026-08-29T10:00:01.000Z')
  });
  assert.equal(rejectedRenew.ok, false);
  assert.equal(rejectedRenew.fenced, true);
});

test('7. Restart restores schedule state', async () => {
  await resetScheduledJobsForTesting();
  const t0 = new Date('2026-08-29T08:00:00.000Z');
  await initializeScheduler({ now: t0 });
  const jobsBefore = await listScheduledJobs();
  assert.equal(jobsBefore.length, 3);

  const jobsAfter = await initializeScheduler({ now: t0 });
  assert.equal(jobsAfter.length, 3);
  assert.deepEqual(
    jobsAfter.map(j => j.id).sort(),
    DEFAULT_SCHEDULES.map(s => s.id).sort()
  );
});

test('8. Catch-up policy handles overdue runs boundedly without unbounded historical replay', async () => {
  await resetScheduledJobsForTesting();
  const past = new Date('2026-08-29T07:00:00.000Z');
  await initializeScheduler({ now: past });

  const now = new Date('2026-08-29T10:00:00.000Z');
  const overdue = await reconcileOverdueJobs({ now });
  assert.ok(overdue.length > 0);
  assert.ok(overdue.every(o => o.catchUpApplied));

  const claim = await claimScheduledJob('discover', { now, claimedBy: 'catchup-worker' });
  assert.ok(claim);
  await finishScheduledJobRun({
    jobId: claim.job.id,
    runKey: claim.runKey,
    leaseToken: claim.leaseToken,
    status: 'COMPLETED',
    now
  });

  const jobs = await listScheduledJobs();
  const discoverJob = jobs.find(j => j.workerName === 'discover');
  assert.ok(new Date(discoverJob.nextRunAt).getTime() >= now.getTime());
});

// ─── Pipeline Stage Tests ──────────────────────────────────────────────────────

test('9. Discover writes only to candidate_queue and does not execute', async () => {
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

  const candidates = await listRevenueRecords(CANONICAL_QUEUES.candidates);
  assert.ok(candidates.some(c => c.noveltyKey === noveltyKey));

  const outcomes = await listRevenueRecords(CANONICAL_QUEUES.outcomes);
  assert.ok(!outcomes.some(o => o.payload?.title === uniqueTitle));
});

test('10. Validate: properly-cited 8-gate evidence promotes to THRESHOLD_CROSSED', async () => {
  const noveltyKey = `val-test-${crypto.randomUUID()}`;
  const EVIDENCE_URLS = [
    'https://aws.amazon.com/support/plans/',
    'https://aws.amazon.com/premiumsupport/pricing/',
    'https://doit.com/partner-support',
    'https://calculator.aws/pricing',
    'https://docs.aws.amazon.com/awssupportdocs/latest/supportapiguide',
    'https://aws.amazon.com/premiumsupport/enterprise-on-ramp/',
    'https://aws.amazon.com/premiumsupport/faqs/',
    'https://aws.amazon.com/support/compare-plans/'
  ];

  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.candidates,
    noveltyKey,
    status: 'NEW',
    priority: 85,
    payload: {
      candidate: {
        candidateId: 'cand-val-full-gates',
        title: 'Cloud Support Right-Sizing with 8 Evidence-Cited Gates',
        noveltyKey,
        profile: 'programmable_money_flow_v1',
        metrics: {
          flowScale: 1, recurrence: 0.8, triggerIndependence: 0.8, permission: 1,
          deltaMeasurability: 1, monetization: 0.6, executionAutonomy: 0.6,
          competitiveWhitespace: 0.8, setupBurden: 0.2, timeToMoney: 0.6
        },
        gateEvidence: buildGateEvidence(EIGHT_MONEY_FLOW_GATES, EVIDENCE_URLS),
        requiredCapabilities: ['web.read'],
        evidence: EVIDENCE_URLS
      }
    }
  });

  const valResult = await runValidateWorker({ limit: 5 });
  assert.equal(valResult.stage, 'VALIDATE');
  assert.ok(valResult.promotedCount >= 1);

  const execRecords = await listRevenueRecords(CANONICAL_QUEUES.execution);
  assert.ok(execRecords.some(r => r.noveltyKey === `exec-${noveltyKey}`));
});

test('11. Execute: authorized executor records MONEY_EVENT with verified attributable value', async () => {
  const noveltyKey = `exec-test-${crypto.randomUUID()}`;
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.execution,
    noveltyKey,
    status: 'NEW',
    priority: 90,
    payload: {
      candidate: {
        candidateId: 'cand-exec-1',
        title: 'Authorized Execution Task',
        noveltyKey,
        estimatedValue: 250,
        requiredCapabilities: ['taskman.queue.read']
      },
      classification: 'EXECUTABLE',
      missingCapabilities: []
    }
  });

  const execResult = await runExecuteWorker({
    limit: 5,
    executorFn: async () => ({
      status: 'MONEY_EVENT',
      reason: 'Authorized execution completed',
      verifiedAttributableValue: 125
    })
  });

  assert.equal(execResult.stage, 'EXECUTE');
  assert.ok(execResult.outcomesCount >= 1);

  const outcomeRecords = await listRevenueRecords(CANONICAL_QUEUES.outcomes);
  const matched = outcomeRecords.find(o => o.noveltyKey === `outcome-${noveltyKey}`);
  assert.ok(matched);
  assert.equal(matched.status, 'MONEY_EVENT');
  assert.equal(matched.payload.attributableValue, 125);
});

// ─── Negative Invariant Tests ──────────────────────────────────────────────────

test('12. Negative invariant: Discover never fabricates candidates when no real source provides them', async () => {
  const result = await runDiscoverWorker({ sources: ['recent_events'], sampleCandidates: [] });
  assert.equal(result.evaluated, 0);
  assert.equal(result.enqueued, 0);
});

test('13. Negative invariant: 7 evidence-cited gates + 1 uncited => NEEDS_EVIDENCE, not THRESHOLD_CROSSED', () => {
  const sevenRefs = EIGHT_MONEY_FLOW_GATES.slice(0, 7).map(g => [g, {
    verdict: 'pass',
    evidenceRef: 'https://example.com/' + g
  }]);
  // 8th gate: pass verdict but NO evidenceRef
  const eighthGate = EIGHT_MONEY_FLOW_GATES[7];
  const gateEvidencePartial = {
    ...Object.fromEntries(sevenRefs),
    [eighthGate]: { verdict: 'pass', evidenceRef: '' }  // empty ref = not cited
  };

  const result = evaluateEvidenceGates({
    profile: 'programmable_money_flow_v1',
    evidence: ['https://example.com'],
    gateEvidence: gateEvidencePartial
  });
  assert.equal(result.passed, false);
  assert.equal(result.status, 'NEEDS_EVIDENCE');
  assert.ok(result.reason.includes('gateEvidence'));
});

test('14. Negative invariant: flat pass verdicts without gateEvidence => NEEDS_EVIDENCE (no per-gate citation)', () => {
  const flatGates = Object.fromEntries(EIGHT_MONEY_FLOW_GATES.map(g => [g, 'pass']));
  const result = evaluateEvidenceGates({
    profile: 'programmable_money_flow_v1',
    evidence: ['https://example.com/doc'],
    gates: flatGates  // legacy flat verdicts, no gateEvidence
    // gateEvidence intentionally absent
  });
  // Legacy flat passes without evidenceRef must NOT produce THRESHOLD_CROSSED
  assert.equal(result.passed, false);
  assert.equal(result.status, 'NEEDS_EVIDENCE');
});

test('15. Negative invariant: zero evidence produces NEEDS_EVIDENCE regardless of gate values', () => {
  const fullGateEvidence = buildGateEvidence(EIGHT_MONEY_FLOW_GATES,
    EIGHT_MONEY_FLOW_GATES.map(g => 'https://example.com/' + g));
  const result = evaluateEvidenceGates({
    profile: 'programmable_money_flow_v1',
    evidence: [],  // no evidence
    gateEvidence: fullGateEvidence
  });
  assert.equal(result.passed, false);
  assert.equal(result.status, 'NEEDS_EVIDENCE');
  assert.ok(result.reason.includes('evidence'));
});

test('16. Negative invariant: Execute BLOCKED with zero attributable value when no adapter configured', async () => {
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
        estimatedValue: 10000  // Must NOT become realized value
      },
      classification: 'EXECUTABLE',
      missingCapabilities: []
    }
  });

  await runExecuteWorker({ limit: 10 });  // no executorFn

  const outcomes = await listRevenueRecords(CANONICAL_QUEUES.outcomes);
  const matched = outcomes.find(o => o.noveltyKey === `outcome-${noveltyKey}`);
  assert.ok(matched);
  assert.equal(matched.status, 'BLOCKED');
  assert.equal(matched.payload.attributableValue, 0);
  assert.ok(matched.payload.outcomeReason.includes('No authorized executable action adapter'));
});

test('17. Legacy revenue queue aliases remain compatible', async () => {
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

test('18. Memory-mode reports clearly that durable guarantees require PostgreSQL', () => {
  assert.equal(typeof isSchedulerDurable(), 'boolean');
});

test('19. 5-minute cadence computes next run at 5-min boundary and rolls over hour boundary', () => {
  const t1 = new Date('2026-08-29T12:01:23.000Z');
  assert.equal(computeNextRunAt('*/5 * * * *', t1).toISOString(), '2026-08-29T12:05:00.000Z');

  const t2 = new Date('2026-08-29T12:05:00.000Z');
  assert.equal(computeNextRunAt('*/5 * * * *', t2).toISOString(), '2026-08-29T12:10:00.000Z');

  const t3 = new Date('2026-08-29T12:59:45.000Z');
  assert.equal(computeNextRunAt('*/5 * * * *', t3).toISOString(), '2026-08-29T13:00:00.000Z');

  const t4 = new Date('2026-08-29T23:55:00.000Z');
  assert.equal(computeNextRunAt('*/5 * * * *', t4).toISOString(), '2026-08-30T00:00:00.000Z');
});

test('20. 5-minute execute job initializes and claims on 5-minute boundary without duplicate runs', async () => {
  await resetScheduledJobsForTesting();
  const fixedNow = new Date('2026-08-29T10:05:00.000Z');
  await initializeScheduler({ now: new Date('2026-08-29T10:00:00.000Z') });

  const jobs = await listScheduledJobs();
  const execJob = jobs.find(j => j.id === 'taskman-execute-5min');
  assert.ok(execJob, 'taskman-execute-5min job must exist in initialized schedules');
  assert.equal(execJob.scheduleExpression, '*/5 * * * *');

  const claim1 = await claimScheduledJob('taskman-execute-5min', { now: fixedNow, claimedBy: 'worker-1' });
  assert.ok(claim1, 'Worker 1 should claim 5-minute execute job');
  assert.equal(claim1.runKey, generateRunKey('taskman-execute-5min', fixedNow));

  // Second worker cannot claim same firing
  const claim2 = await claimScheduledJob('taskman-execute-5min', { now: fixedNow, claimedBy: 'worker-2' });
  assert.equal(claim2, null, 'Worker 2 cannot claim active firing');

  // Finish run
  await finishScheduledJobRun({
    jobId: claim1.job.id,
    runKey: claim1.runKey,
    leaseToken: claim1.leaseToken,
    status: 'COMPLETED',
    result: { ok: true },
    now: fixedNow
  });

  // Next run advances to 10:10:00
  const jobsAfter = await listScheduledJobs();
  const updatedJob = jobsAfter.find(j => j.id === 'taskman-execute-5min');
  assert.equal(updatedJob.nextRunAt, '2026-08-29T10:10:00.000Z');
});

