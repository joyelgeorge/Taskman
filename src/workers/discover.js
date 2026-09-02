import {
  CANONICAL_QUEUES,
  DISCOVERY_SOURCES,
  capabilitySnapshot
} from '../orchestration-profiles.js';
import {
  normalizeCandidate,
  qualifyCandidate,
  missingCapabilities
} from '../qualification-engine.js';
import {
  upsertRevenueRecord,
  listRevenueRecords,
  setRevenueState,
  getRevenueState
} from '../revenue-store.js';
import { discoverRail } from '../rails/index.js';
import { isRailEnabled } from '../money-ledger.js';

/**
 * Loads real candidates from configured discovery sources.
 *
 * Sources are:
 * 1. Explicitly passed sampleCandidates / items from external API/webhook/scouts.
 * 2. Real configured rails whose ledger state is not DISABLED (e.g. TaskForce).
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

  // 2. Discover from configured rails if available and not disabled by the ledger.
  // Both rails registered today (taskforce, moltjobs) measured at effectively zero
  // settlement in the market they target — see docs/TARGET_DESIGN.md §2 — so they
  // ship disabled by default (src/rails/dead-rails.js) and this call is a no-op
  // until a human re-enables one with evidence that has changed.
  if (sources.includes('bounty') || sources.includes('immediate_income')) {
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
export async function runDiscoverWorker({
  sources = Object.keys(DISCOVERY_SOURCES),
  sampleCandidates = [],
  claimedBy = 'taskman-discover-worker'
} = {}) {
  const startedAt = new Date().toISOString();
  const learningState = await getRevenueState('discovery_learning') || { sourcesEvaluated: 0, totalEnqueued: 0 };
  const existingCandidates = await listRevenueRecords(CANONICAL_QUEUES.candidates, { limit: 500 });
  const existingNoveltyKeys = new Set(existingCandidates.map(c => c.noveltyKey).filter(Boolean));

  const candidatesToProcess = await discoverFromRealSources({ sources, sampleCandidates });

  if (candidatesToProcess.length === 0) {
    // Silence here is the failure mode this worker exists to avoid repeating —
    // see docs/SYSTEM_DESIGN.md §9. Say so loudly rather than returning quietly.
    console.warn(`[discover] zero candidates from ${sources.length} source(s): ${sources.join(', ')}. No real source produced anything this run.`);
  }

  const enqueued = [];
  const rejected = [];
  const capabilities = capabilitySnapshot();

  for (const candidate of candidatesToProcess) {
    // Deduplication by novelty key
    if (candidate.noveltyKey && existingNoveltyKeys.has(candidate.noveltyKey)) {
      continue;
    }

    const profileName = candidate.profile || 'programmable_money_flow_v1';
    const qual = qualifyCandidate(candidate, profileName);
    const missing = missingCapabilities(candidate, capabilities);

    if (qual.passes) {
      const record = await upsertRevenueRecord({
        queue: CANONICAL_QUEUES.candidates,
        noveltyKey: candidate.noveltyKey,
        status: 'NEW',
        priority: Math.round(qual.score * 10),
        payload: {
          candidate,
          qualification: qual,
          missingCapabilities: missing,
          discoveredAt: startedAt,
          discoveredBy: claimedBy
        }
      });
      enqueued.push(record);
      if (candidate.noveltyKey) existingNoveltyKeys.add(candidate.noveltyKey);
    } else {
      rejected.push({
        candidateId: candidate.candidateId,
        title: candidate.title,
        reason: 'Failed deterministic qualification gates',
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

  if (rejected.length > 0 || enqueued.length > 0) {
    await upsertRevenueRecord({
      queue: CANONICAL_QUEUES.inference,
      noveltyKey: `inference-discover-${startedAt.slice(0, 13)}`,
      status: 'NEW',
      priority: 5,
      payload: {
        stage: 'DISCOVER',
        evaluatedCount: candidatesToProcess.length,
        enqueuedCount: enqueued.length,
        rejectedCount: rejected.length,
        timestamp: startedAt
      }
    });
  }

  return {
    stage: 'DISCOVER',
    status: 'COMPLETED',
    evaluated: candidatesToProcess.length,
    enqueued: enqueued.length,
    rejected: rejected.length,
    enqueuedRecords: enqueued,
    sourcesQueried: sources,
    zeroCandidates: candidatesToProcess.length === 0,
    timestamp: startedAt
  };
}

if (process.argv[1]?.endsWith('discover.js')) {
  runDiscoverWorker().then(res => console.log(JSON.stringify(res, null, 2))).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
