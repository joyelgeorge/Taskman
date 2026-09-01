import {
  upsertRevenueRecord, listRevenueRecords, claimRevenueRecords,
  updateRevenueRecord, setRevenueState, getRevenueState, revenueStorageMode
} from './revenue-store.js';
import {
  CANONICAL_QUEUES, LEGACY_QUEUE_ALIASES, DISCOVERY_SOURCES,
  QUALIFICATION_PROFILES, resolveQueueName
} from './orchestration-profiles.js';
import { getSafeCapabilitySnapshot } from './capability-registry.js';
import { normalizeCandidate, qualifyCandidate } from './qualification-engine.js';
import {
  listScheduledJobs, claimScheduledJob, finishScheduledJobRun, isSchedulerDurable
} from './durable-scheduler.js';
import { runDiscoverWorker } from './workers/discover.js';
import { runValidateWorker } from './workers/validate.js';
import { runExecuteWorker } from './workers/execute.js';
import { readJsonBody } from './limits.js';
import {
  getObservabilitySnapshot,
  getPipelineObservabilitySummary,
  recordScheduleRun,
  withTelemetrySpan
} from './observability.js';

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
  return true;
}

export async function handleRevenueRequest(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/revenue/observability') {
    return send(res, 200, {
      pipeline: await getPipelineObservabilitySummary({
        maxStallMinutes: Number(url.searchParams.get('maxStallMinutes') || 60)
      }),
      telemetry: getObservabilitySnapshot({ includeTraces: url.searchParams.get('traces') !== 'false' })
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/revenue/status') {
    return send(res, 200, {
      storage: revenueStorageMode(),
      schedulerDurable: isSchedulerDurable(),
      internalSchedulerEnabled: process.env.TASKMAN_INTERNAL_SCHEDULER_ENABLED === 'true',
      pipeline: ['DISCOVER', 'VALIDATE', 'EXECUTE', 'LEARN'],
      canonicalQueues: CANONICAL_QUEUES,
      legacyAliases: LEGACY_QUEUE_ALIASES,
      queues: [
        ...Object.values(CANONICAL_QUEUES),
        'revenue_exploration_queue','revenue_execution_results','revenue_recent_scan',
        'revenue_prediction_research','revenue_model_inference','revenue_opportunity_deepdives','revenue_scan_inference'
      ]
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/orchestration/config') {
    return send(res, 200, {
      pipeline: ['DISCOVER', 'VALIDATE', 'EXECUTE', 'LEARN'],
      queues: CANONICAL_QUEUES,
      legacyAliases: LEGACY_QUEUE_ALIASES,
      discoverySources: DISCOVERY_SOURCES,
      qualificationProfiles: QUALIFICATION_PROFILES,
      scheduler: {
        durable: isSchedulerDurable(),
        internalEnabled: process.env.TASKMAN_INTERNAL_SCHEDULER_ENABLED === 'true',
        staggeredCadence: {
          discover: '0 * * * *',
          validate: '10 * * * *',
          execute: '20 * * * *'
        }
      }
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/scheduler/jobs') {
    return send(res, 200, {
      durable: isSchedulerDurable(),
      internalSchedulerEnabled: process.env.TASKMAN_INTERNAL_SCHEDULER_ENABLED === 'true',
      jobs: await listScheduledJobs()
    });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/scheduler\/jobs\/([^/]+)\/trigger$/)) {
    const match = url.pathname.match(/^\/api\/scheduler\/jobs\/([^/]+)\/trigger$/);
    const workerName = decodeURIComponent(match[1]).toLowerCase();
    const input = await readJsonBody(req);
    const claimedBy = input.claimedBy || 'manual-trigger';

    const claim = await claimScheduledJob(workerName, { claimedBy });
    if (!claim) {
      return send(res, 409, {
        error: 'Job cannot be claimed (not due or active lease owned by another worker)',
        workerName
      });
    }

    let result = null;
    let error = null;
    const runStarted = Date.now();
    try {
      result = await withTelemetrySpan('api.scheduler.trigger', {
        correlation_id: claim.runKey,
        run_key: claim.runKey,
        schedule_id: claim.job.id,
        stage: workerName.toUpperCase(),
        route: '/api/scheduler/jobs/:worker/trigger',
        method: 'POST'
      }, async () => {
        const options = {
          claimedBy,
          correlationId: claim.runKey,
          runKey: claim.runKey,
          scheduleId: claim.job.id
        };
        if (workerName === 'discover') return runDiscoverWorker(options);
        if (workerName === 'validate') return runValidateWorker(options);
        if (workerName === 'execute') return runExecuteWorker(options);
        throw new Error(`Unknown worker: ${workerName}`);
      });

      await finishScheduledJobRun({
        jobId: claim.job.id,
        runKey: claim.runKey,
        status: 'COMPLETED',
        result
      });
      recordScheduleRun({
        runKey: claim.runKey, scheduleId: claim.job.id, stage: workerName,
        scheduledFor: claim.scheduledFor, outcome: 'COMPLETED', durationMs: Date.now() - runStarted
      });
      return send(res, 200, { ok: true, claim, result });
    } catch (err) {
      error = err.message;
      await finishScheduledJobRun({
        jobId: claim.job.id,
        runKey: claim.runKey,
        status: 'FAILED',
        error
      });
      recordScheduleRun({
        runKey: claim.runKey, scheduleId: claim.job.id, stage: workerName,
        scheduledFor: claim.scheduledFor, outcome: 'FAILED', durationMs: Date.now() - runStarted
      });
      return send(res, 500, { ok: false, claim, error });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/capabilities') {
    return send(res, 200, getSafeCapabilitySnapshot());
  }

  if (req.method === 'POST' && url.pathname === '/api/qualification') {
    const input = await readJsonBody(req);
    const candidate = normalizeCandidate(input.candidate || input);
    const profile = input.profile || candidate.profile || 'programmable_money_flow_v1';
    if (!QUALIFICATION_PROFILES[profile]) {
      return send(res, 400, { error: 'unknown qualification profile', profile });
    }
    const qualification = qualifyCandidate(candidate, profile);
    return send(res, 200, {
      candidate,
      qualification,
      missingCapabilities: [
        ...qualification.capabilities.setupRequired,
        ...qualification.capabilities.unavailable,
        ...qualification.capabilities.unhealthy
      ]
    });
  }

  const list = url.pathname.match(/^\/api\/revenue\/queues\/([^/]+)$/);
  if (req.method === 'GET' && list) {
    const queueName = resolveQueueName(decodeURIComponent(list[1]));
    return send(res, 200, await listRevenueRecords(queueName, {
      status: url.searchParams.get('status') || undefined,
      limit: url.searchParams.get('limit') || 100
    }));
  }
  if (req.method === 'POST' && list) {
    const input = await readJsonBody(req);
    const records = Array.isArray(input) ? input : [input];
    const output = [];
    const queueName = resolveQueueName(decodeURIComponent(list[1]));
    for (const record of records) output.push(await upsertRevenueRecord({ ...record, queue: queueName }));
    return send(res, 201, Array.isArray(input) ? output : output[0]);
  }

  const claim = url.pathname.match(/^\/api\/revenue\/queues\/([^/]+)\/claim$/);
  if (req.method === 'POST' && claim) {
    const input = await readJsonBody(req);
    const queueName = resolveQueueName(decodeURIComponent(claim[1]));
    return send(res, 200, await claimRevenueRecords(queueName, {
      limit: input.limit || 10,
      claimedBy: input.claimedBy || 'taskman-worker'
    }));
  }

  const record = url.pathname.match(/^\/api\/revenue\/records\/([^/]+)$/);
  if (req.method === 'PATCH' && record) {
    const updated = await updateRevenueRecord(record[1], await readJsonBody(req));
    return updated ? send(res, 200, updated) : send(res, 404, { error: 'record not found' });
  }

  const state = url.pathname.match(/^\/api\/revenue\/state\/([^/]+)$/);
  if (req.method === 'GET' && state) return send(res, 200, { key: state[1], value: await getRevenueState(state[1]) });
  if (req.method === 'PUT' && state) {
    const input = await readJsonBody(req);
    return send(res, 200, await setRevenueState(state[1], input.value ?? input));
  }
  return false;
}
