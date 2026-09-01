import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
 * Sources can be:
 * 1. Explicitly passed sampleCandidates / items from external API/webhook/scouts.
 * 2. Real configured rails (e.g. TaskForce rail if configured).
 * 3. Real persisted research runs/anchor files (e.g. data/money-flow-search-history.json).
 * 
 * Invariant: NEVER fabricate candidates or synthetic opportunity metrics.
 * If no real source produces candidates, returns an empty list.
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

  // 2. Discover from configured rails if available
  if (sources.includes('bounty') || sources.includes('immediate_income')) {
    try {
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

  // 3. Ingest active hypothesis from real persisted research anchor if requested
  if (sources.includes('structural_money_flow') && discovered.length === 0) {
    try {
      const historyFile = join(process.cwd(), 'data', 'money-flow-search-history.json');
      const raw = await readFile(historyFile, 'utf8');
      const data = JSON.parse(raw);
      if (data?.current_leader && data.current_leader.id) {
        const leader = data.current_leader;
        discovered.push(normalizeCandidate({
          sourceType: 'structural_money_flow',
          profile: 'programmable_money_flow_v1',
          candidateId: leader.id,
          noveltyKey: `anchor-${leader.id}-${data.updated_at || data.schema_version}`,
          title: leader.name,
          moneyFlow: leader.state_transition,
          trigger: leader.smallest_intervention,
          evidence: [leader.strongest_evidence, leader.why_survived].filter(Boolean),
          confidence: (leader.score && leader.max_score) ? leader.score / leader.max_score : 0.7,
          metrics: {
            flowScale: (leader.component_scores?.flow_scale || 0) / 5,
            recurrence: (leader.component_scores?.leakage_magnitude || 0) / 5,
            triggerIndependence: (leader.component_scores?.trigger_independence || 0) / 5,
            permission: (leader.component_scores?.permission_non_invasiveness || 0) / 5,
            deltaMeasurability: (leader.component_scores?.delta_measurability || 0) / 5,
            monetization: (leader.component_scores?.monetization || 0) / 5,
            executionAutonomy: (leader.component_scores?.build_simplicity || 0) / 5,
            competitiveWhitespace: (leader.component_scores?.competitive_whitespace || 0) / 5,
            setupBurden: (leader.component_scores?.distribution_burden || 0) / 5,
            timeToMoney: (leader.component_scores?.integration_friction || 0) / 5
          },
          requiredCapabilities: ['web.read'],
          raw: leader
        }));
      }
    } catch {
      // File missing or unreadable; do not invent records
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
 */
import { sharedReasoningEngine } from '../reasoning-engine.js';

async function runDiscoverWorkerImpl({
  sources = Object.keys(DISCOVERY_SOURCES),
  sampleCandidates = [],
  claimedBy = 'taskman-discover-worker',
  mockAiReasoning = null,
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

  // Gather baseline candidates from configured real sources
  let candidatesToProcess = await discoverFromRealSources({ sources, sampleCandidates });

  // If reasoning engine is available and we have source evidence / sample items, synthesize with AI
  if ((sharedReasoningEngine.isConfigured() || mockAiReasoning) && sampleCandidates.length > 0) {
    try {
      const aiResult = await sharedReasoningEngine.synthesizeDiscovery({
        sourceEvidence: sampleCandidates,
        existingHypotheses: existingCandidates.slice(0, 10),
        mockProvider: mockAiReasoning
      });
      if (aiResult.ok && Array.isArray(aiResult.data?.candidates)) {
        for (const aiCand of aiResult.data.candidates) {
          candidatesToProcess.push(normalizeCandidate(aiCand));
        }
      }
    } catch {
      // Fail safely without blocking baseline discovery
    }
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
