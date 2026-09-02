import {
  CANONICAL_QUEUES,
  DISCOVERY_SOURCES
} from '../orchestration-profiles.js';
import {
  normalizeCandidate,
  qualifyCandidate
} from '../qualification-engine.js';
import {
  upsertRevenueRecord,
  listRevenueRecords,
  setRevenueState,
  getRevenueState
} from '../revenue-store.js';
import { discoverRail } from '../rails/index.js';
import { isRailEnabled } from '../money-ledger.js';
import {
  applyLearningToCandidates,
  compileLearningGuidance,
  listActiveLearning,
  recordLearningInference
} from '../learning-inference.js';
import { addTraceEvent, recordStageResult, withTelemetrySpan } from '../observability.js';
import { logRestrictedError } from '../errors.js';

/**
 * Loads real candidates from configured discovery sources.
 *
 * Sources are:
 * 1. Explicitly passed sampleCandidates / items from external API/webhook/scouts.
 * 2. Real configured rails whose ledger state is not DISABLED (taskforce), plus
 *    deskcrew and taskmarket, which are gated by their own enable flags and
 *    execution-mode checks rather than the settlement ledger — see
 *    src/capability-registry.js for how their capabilities are reported.
 * 3. `@taskman/core` drones (packages/core/drones) via the signal-process cron,
 *    which is the deterministic collector layer this system now runs on — see
 *    docs/AUTONOMOUS_SYSTEM.md. Drone output reaches candidate_queue directly and
 *    does not pass through this function.
 *
 * Invariant: NEVER fabricate candidates or synthetic opportunity metrics.
 * If no real source produces candidates, returns an empty list — and this worker
 * says so loudly rather than silently repeating a prior conclusion. A discovery
 * source that reads its own previous output is exactly the closed loop documented
 * in docs/SYSTEM_DESIGN.md §9; there must be no path back to it here.
 */
export async function discoverFromRealSources({
  sources = Object.keys(DISCOVERY_SOURCES),
  sampleCandidates = []
} = {}) {
  const discovered = [];

  // 1. Ingest any explicitly supplied real candidate payloads
  for (const c of sampleCandidates) {
    discovered.push(normalizeCandidate(c));
  }

  // 2. Discover from configured rails if available.
  if (sources.includes('bounty') || sources.includes('immediate_income')) {
    // Both rails registered today that ARE gated by the settlement ledger
    // (taskforce, moltjobs) measured at effectively zero settlement in the
    // market they target — see docs/TARGET_DESIGN.md §2 — so they ship disabled
    // by default (src/rails/dead-rails.js) and this call is a no-op until a
    // human re-enables one with evidence that has changed.
    try {
      if (await isRailEnabled('taskforce')) {
        const taskforceResult = await discoverRail('taskforce');
        if (taskforceResult?.ok && Array.isArray(taskforceResult.tasks)) {
          for (const t of taskforceResult.tasks) {
            discovered.push(normalizeCandidate({
              sourceType: 'bounty',
              profile: 'bounty_execution_v1',
              candidateId: t.id || t.taskId,
              noveltyKey: `taskforce-${t.id || t.taskId}`,
              title: t.title || t.name,
              estimatedValue: Number(t.reward || t.budget || 0),
              metrics: t.metrics || {},
              evidence: t.evidence || [],
              requiredCapabilities: t.requiredCapabilities || ['taskman.queue.read'],
              raw: t
            }));
          }
        }
      }
    } catch {
      // Rail not configured or unavailable; fail closed without fabricating
    }
    try {
      const deskcrewResult = await discoverRail('deskcrew');
      if (deskcrewResult?.ok && Array.isArray(deskcrewResult.bounties)) {
        for (const bounty of deskcrewResult.bounties) discovered.push(normalizeCandidate(bounty));
      }
    } catch {
      // Provider failures are retryable at the rail boundary and never fabricate candidates.
    }
    try {
      const result = await discoverRail('taskmarket');
      if (result?.ok && Array.isArray(result.tasks)) {
        for (const task of result.tasks) discovered.push(normalizeCandidate(task));
      }
    } catch {
      // Provider failures are retryable at the rail boundary and never fabricate candidates.
    }
  }

  return discovered;
}

/**
 * Taskman Discover Worker
 *
 * Responsibilities:
 * 1. Load learning_inference and discovery state.
 * 2. Invoke real configured source plugins/families.
 * 3. Normalize candidates with normalizeCandidate().
 * 4. Deduplicate by novelty key/evidence.
 * 5. Call shared qualifyCandidate() with the selected profile.
 * 6. Enqueue accepted candidates into candidate_queue.
 * 7. Persist source performance / discovery state into learning_inference.
 *
 * It must NOT execute candidate work or perform the full adversarial validation stage.
 * It must NEVER fabricate synthetic candidates or hardcode positive metrics.
 * It must NEVER call a model to invent or synthesize a candidate: asking an LLM
 * "what is a valuable unresolved money gap" returns the same answer every other
 * holder of that model gets, so anything discoverable by prompting is arbitraged
 * to zero on discovery — see docs/TARGET_DESIGN.md §1. Discovery is deterministic
 * by contract; a model may only ever transform a candidate that already exists
 * (src/transforms/), never originate one.
 */
async function runDiscoverWorkerImpl({
  sources = Object.keys(DISCOVERY_SOURCES),
  sampleCandidates = [],
  claimedBy = 'taskman-discover-worker',
  capabilityOptions = {},
  signal
} = {}) {
  signal?.throwIfAborted();
  const startedAt = new Date().toISOString();
  const learningState = await getRevenueState('discovery_learning') || { sourcesEvaluated: 0, totalEnqueued: 0 };
  const existingCandidates = await listRevenueRecords(CANONICAL_QUEUES.candidates, { limit: 500 });
  const existingNoveltyKeys = new Set(existingCandidates.map(c => c.noveltyKey).filter(Boolean));
  const activeLearning = await listActiveLearning({ now: new Date(startedAt) });
  const guidance = compileLearningGuidance(activeLearning);

  let candidatesToProcess = await discoverFromRealSources({ sources, sampleCandidates });

  if (candidatesToProcess.length === 0) {
    // Silence here is the failure mode this worker exists to avoid repeating —
    // see docs/SYSTEM_DESIGN.md §9. Say so loudly rather than returning quietly.
    console.warn(`[discover] zero candidates from ${sources.length} source(s): ${sources.join(', ')}. No real source produced anything this run.`);
  }

  const learnedOrdering = applyLearningToCandidates(candidatesToProcess, guidance, {
    minimumSourceDiversity: Math.min(2, new Set(candidatesToProcess.map(c => c.sourceType)).size)
  });
  candidatesToProcess = learnedOrdering.candidates;

  const enqueued = [];
  const rejected = [];
  for (const candidate of candidatesToProcess) {
    signal?.throwIfAborted();
    // Deduplication by novelty key
    if (candidate.noveltyKey && existingNoveltyKeys.has(candidate.noveltyKey)) {
      continue;
    }

    const profileName = candidate.profile || 'programmable_money_flow_v1';
    const qual = qualifyCandidate(candidate, profileName, { capabilityOptions });
    const missing = [
      ...qual.capabilities.setupRequired,
      ...qual.capabilities.unavailable,
      ...qual.capabilities.unhealthy
    ];

    if (qual.eligibleForValidation) {
      const record = await upsertRevenueRecord({
        queue: CANONICAL_QUEUES.candidates,
        noveltyKey: candidate.noveltyKey,
        status: 'NEW',
        priority: Math.round(qual.score * 10),
        payload: {
          candidate,
          qualification: qual,
          missingCapabilities: missing,
          learning: {
            appliedLearningIds: guidance.appliedLearningIds,
            adjustment: candidate.learningAdjustment || 0,
            mandatoryChecks: guidance.mandatoryChecks
          },
          discoveredAt: startedAt,
          discoveredBy: claimedBy
        }
      });
      enqueued.push(record);
      addTraceEvent('queue.enqueue', {
        stage: 'DISCOVER', queue: 'candidates', candidate_id: candidate.candidateId,
        queue_item_id: record.id, outcome: 'enqueued'
      });
      if (candidate.noveltyKey) existingNoveltyKeys.add(candidate.noveltyKey);
    } else {
      rejected.push({
        candidateId: candidate.candidateId,
        title: candidate.title,
        reason: qual.evidence.status === 'REJECTED'
          ? qual.evidence.reason
          : 'Failed deterministic qualification gates',
        failures: qual.hardGateFailures,
        score: qual.score,
        threshold: qual.threshold
      });
    }
  }

  // Persist discovery state & feedback into learning_inference
  const updatedLearning = {
    ...learningState,
    lastRunAt: startedAt,
    sourcesEvaluated: (learningState.sourcesEvaluated || 0) + sources.length,
    totalEnqueued: (learningState.totalEnqueued || 0) + enqueued.length,
    recentEnqueuedCount: enqueued.length,
    recentRejectedCount: rejected.length
  };
  await setRevenueState('discovery_learning', updatedLearning);

  for (const source of new Set(candidatesToProcess.map(c => c.sourceType || 'unknown'))) {
    signal?.throwIfAborted();
    const sourceCandidates = candidatesToProcess.filter(c => (c.sourceType || 'unknown') === source);
    const sourceRejected = rejected.filter(item => sourceCandidates.some(c => c.candidateId === item.candidateId));
    if (sourceCandidates.length === 0) continue;
    await recordLearningInference({
      statement: `${source} discovery produced ${sourceRejected.length} deterministic rejections from ${sourceCandidates.length} candidates`,
      classification: 'TEMPORARY_HINT',
      confidence: Math.min(0.75, 0.4 + (sourceCandidates.length * 0.05)),
      supportingEvidence: sourceCandidates.map(candidate => candidate.noveltyKey || candidate.candidateId).filter(Boolean),
      sourceWorker: claimedBy,
      scope: `source:${source}`,
      weightAdjustment: {
        targetType: 'source',
        target: source,
        delta: sourceRejected.length === sourceCandidates.length ? -0.1 : 0.05
      },
      createdAt: startedAt
    }, { now: new Date(startedAt) });
  }

  return {
    stage: 'DISCOVER',
    status: 'COMPLETED',
    evaluated: candidatesToProcess.length,
    enqueued: enqueued.length,
    rejected: rejected.length,
    hardFiltered: learnedOrdering.hardFiltered.length,
    appliedLearningIds: guidance.appliedLearningIds,
    enqueuedRecords: enqueued,
    sourcesQueried: sources,
    zeroCandidates: candidatesToProcess.length === 0,
    timestamp: startedAt
  };
}

export async function runDiscoverWorker(options = {}) {
  const started = Date.now();
  return withTelemetrySpan('pipeline.discover', {
    correlation_id: options.correlationId,
    run_key: options.runKey,
    schedule_id: options.scheduleId,
    stage: 'DISCOVER'
  }, async () => {
    const result = await runDiscoverWorkerImpl(options);
    result.durationMs = Date.now() - started;
    recordStageResult('DISCOVER', result);
    return result;
  });
}

if (process.argv[1]?.endsWith('discover.js')) {
  runDiscoverWorker().then(res => console.log(JSON.stringify(res, null, 2))).catch(err => {
    logRestrictedError(err, { context: 'worker:discover:cli' });
    process.exit(1);
  });
}
