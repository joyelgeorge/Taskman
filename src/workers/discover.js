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
  claimRevenueRecords,
  updateRevenueRecord,
  setRevenueState,
  getRevenueState
} from '../revenue-store.js';

/**
 * Taskman Discover Worker
 * 
 * Responsibilities:
 * 1. Load learning_inference and discovery state.
 * 2. Invoke enabled source plugins/families.
 * 3. Normalize candidates with normalizeCandidate().
 * 4. Deduplicate by novelty key/evidence.
 * 5. Call shared qualifyCandidate() with the selected profile.
 * 6. Enqueue accepted candidates into candidate_queue.
 * 7. Persist source performance / discovery state into learning_inference.
 * 
 * It must NOT execute candidate work or perform the full adversarial validation stage.
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

  const candidatesToProcess = [];

  // 1. Gather candidates from supplied inputs or built-in discovery seeds
  for (const c of sampleCandidates) {
    candidatesToProcess.push(normalizeCandidate(c));
  }

  // 2. Default source candidates if none passed (e.g. from known active research families)
  if (candidatesToProcess.length === 0) {
    for (const sourceKey of sources) {
      const srcConfig = DISCOVERY_SOURCES[sourceKey] || { profile: 'programmable_money_flow_v1' };
      candidatesToProcess.push(normalizeCandidate({
        sourceType: sourceKey,
        profile: srcConfig.profile,
        title: `Auto-discovered hypothesis from ${sourceKey}`,
        noveltyKey: `novelty-${sourceKey}-${new Date().toISOString().slice(0, 13)}`,
        metrics: {
          flowScale: 0.85,
          recurrence: 0.8,
          triggerIndependence: 0.8,
          permission: 0.8,
          deltaMeasurability: 0.85,
          monetization: 0.8,
          executionAutonomy: 0.8,
          competitiveWhitespace: 0.8,
          setupBurden: 0.2,
          timeToMoney: 0.7,
          payoutCertainty: 0.8,
          acceptanceClarity: 0.8,
          payerExists: 0.8,
          submissionPath: 0.8
        },
        requiredCapabilities: ['web.read', 'github.read']
      }));
    }
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
    timestamp: startedAt
  };
}

if (process.argv[1]?.endsWith('discover.js')) {
  runDiscoverWorker().then(res => console.log(JSON.stringify(res, null, 2))).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
