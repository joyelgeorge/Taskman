import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { providerStatus, runWithFallback } from './providers.js';
import { LIMITS, configureServerTimeouts, readJsonBody } from './limits.js';
import { getKnowledgeSnapshot, recordRunLearning, ingestStructuredLearning } from './knowledge-store.js';
import { buildLearningPrompt, parseLearningEnvelope, validateLearningEnvelope } from './structured-learning.js';
import { databaseEnabled, migrate, healthCheck as dbHealth, pool } from './db.js';
import { evaluateHealth, livenessSnapshot } from './health.js';
import { seedScenarios, seedCoreTasks, listScenarios } from './scenario-store.js';
import { getBrainState, executeBrainCycle, listBrainCycles } from './brain-controller.js';
import { handleMoltJobsRequest } from './moltjobs-routes.js';
import { handleRevenueRequest } from './revenue-routes.js';
import {
  createTaskRecord, listTaskRecords, getTaskRecord, toggleTaskStatus,
  createRunRecord, finishRunRecord, listRunRecords, recordUsage, usageSummary,
  quarantineInvalidIntervalTriggers
} from './task-store.js';
import { normalizeBrainIntervalMinutes, normalizeIntervalMinutes } from './interval-validator.js';
import {
  initializeScheduler, reconcileOverdueJobs, claimScheduledJob, finishScheduledJobRun, isSchedulerDurable, DEFAULT_SCHEDULES
} from './durable-scheduler.js';
import { runDiscoverWorker } from './workers/discover.js';
import { runValidateWorker } from './workers/validate.js';
import { runExecuteWorker } from './workers/execute.js';
import {
  BILLABLE_METRICS, initializeMetering, requireEntitlement, recordMeterEvent,
  accountUsageSummary, checkEntitlement, billingExportStatus
} from './metering.js';
import { syncGitHubWork, getActionableWorkQueue, claimActionableWorkItem, releaseActionableWorkItem, WORK_ELIGIBILITY } from './github-intake.js';
import { listExecutionRuns, dispatchCodingAgentWork } from './adapters/coding-agent-adapter.js';
import { listMergeTrainRecords, processMergeTrainStep } from './merge-train.js';
import { createStrategicObjective, listStrategicObjectives, addStrategicDirective, generateStrategicBrief } from './strategic-control-plane.js';
import { COMMERCIAL_WEDGE_SPEC, reconcileFiverrPayoutBatch } from './commercial-wedge.js';
import { FIRST_PAYING_CUSTOMER_PROFILE, qualifyProspect } from './customer-profile.js';
import { MINIMUM_STACK_CONFIG, verifyCustomerStackReady } from './integration-stack.js';
import {
  getCustomerWorkflowState,
  configureCustomerWorkflow,
  setCustomerIntegration,
  setCustomerWorkflowActive,
  executeCustomerReconciliation
} from './customer-workflow.js';
import {
  calculateValueLinkedBilling,
  transitionInvoiceCommercialState,
  getAccountBillableEvents,
  BILLING_RULES
} from './value-billing.js';
import {
  REUSABLE_CUSTOMER_TEMPLATE_SPEC,
  instantiateCustomerTemplate,
  verifyInstanceReadiness,
  setInstanceIntegration,
  setInstanceActive,
  executeInstanceReconciliation,
  getCustomerInstance,
  listCustomerInstances
} from './customer-template.js';
import {
  PRIMARY_ACQUISITION_CHANNEL,
  recordProspect,
  advanceProspectStage,
  getFunnelMetrics
} from './acquisition-funnel.js';
import { applySecurityHeaders } from './http-security.js';
import {
  getObservabilitySnapshot,
  getPipelineObservabilitySummary,
  recordMetric,
  recordScheduleRun,
  withTelemetrySpan
} from './observability.js';
import {
  createExecutionTracker,
  createShutdownCoordinator,
  installShutdownSignals
} from './shutdown.js';
import {
  AppError,
  logRestrictedError,
  requestCorrelationId,
  sendJson,
  sendProblem,
  stableErrorCode
} from './errors.js';
import { getRuntimeConfig } from './config.js';
import { handleEconomicSelectorRequest } from './economic-selector.js';
import { runIdempotentMutation, sendIdempotentResult } from './idempotency-http.js';

// Money-ledger routes (/api/money/*) live on the separate packages/api service
// now — see docs/AUTONOMOUS_SYSTEM.md — rather than duplicated onto this legacy
// server. money-ledger.js and rail-governor.js are still the only place the
// data itself is allowed to live; both remain reachable from here for anything
// that needs to read them directly (e.g. capability-registry.js via railStatus()).

const runtimeConfig = getRuntimeConfig();

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const port = runtimeConfig.port;
const timers = new Map();
const memoryUsage = { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
let brainTimer = null;
let internalSchedulerTimer = null;
const executionTracker = createExecutionTracker();
let shutdownCoordinator = null;

function boundedRoute(pathname) {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .slice(0, 120);
}

function observeApiRequest(req, res, pathname) {
  const started = Date.now();
  const route = boundedRoute(pathname);
  res.once('finish', () => {
    const labels = {
      method: req.method,
      route,
      status_class: `${Math.floor(res.statusCode / 100)}xx`
    };
    recordMetric('api_requests_total', 1, labels);
    recordMetric('api_request_duration_ms', Date.now() - started, labels, { kind: 'histogram' });
  });
}

function json(res, status, body) {
  return sendJson(res, status, body);
}

async function idempotentJson(req, res, options) {
  return sendIdempotentResult(res, await runIdempotentMutation(req, options), json);
}

function compactKnowledge(knowledge) {
  return {
    knownFacts: knowledge.knownFacts.slice(-8).map(e => e.value ?? e),
    activeAssumptions: knowledge.activeAssumptions.slice(-5).map(e => e.value ?? e),
    rejectedPaths: knowledge.rejectedPaths.slice(-8).map(e => e.value ?? e),
    openGaps: knowledge.openGaps.slice(-5).map(e => e.value?.gap ?? e.value ?? e),
    moneyEvents: knowledge.moneyEvents.slice(-5).map(e => e.value ?? e),
    latestFuturePath: knowledge.latestFuturePath?.value || null
  };
}

function deriveNextAction(envelope, run) {
  if (run.status !== 'succeeded') return 'Resolve the failure cause before repeating the same route.';
  const event = envelope?.events?.find(e => e.type === 'future_path');
  return event?.value?.nextBestAction || 'Use the updated knowledge state to select the next unresolved money-relevant gap.';
}

async function executeTask(task, reason = 'manual', signal) {
  const run = {
    id: crypto.randomUUID(), taskId: task.id, scenarioId: task.scenarioId || null,
    accountId: task.accountId || process.env.TASKMAN_DEFAULT_ACCOUNT_ID || 'local-default',
    reason, status: 'running', startedAt: new Date().toISOString()
  };
  await createRunRecord(run);

  const knowledgeBefore = await getKnowledgeSnapshot({ taskId: task.id });
  let envelope = null;
  try {
    const maximumRunTokens = Number(process.env.TASKMAN_MAX_RUN_TOKENS || 4096);
    if (!Number.isInteger(maximumRunTokens) || maximumRunTokens < 1) throw new Error('INVALID_MAX_RUN_TOKENS');
    await requireEntitlement({
      accountId: run.accountId,
      metricId: BILLABLE_METRICS.AI_TOKENS.id,
      metricVersion: BILLABLE_METRICS.AI_TOKENS.version,
      proposedQuantity: maximumRunTokens
    });
    await requireEntitlement({
      accountId: run.accountId,
      metricId: BILLABLE_METRICS.SUCCESSFUL_RUNS.id,
      metricVersion: BILLABLE_METRICS.SUCCESSFUL_RUNS.version,
      proposedQuantity: 1
    });

    const prompt = buildLearningPrompt({ objective: task.prompt, context: compactKnowledge(knowledgeBefore) });
    const result = await runWithFallback(prompt, { runTimeoutMs: LIMITS.runTimeoutMs, signal });
    envelope = validateLearningEnvelope(parseLearningEnvelope(result.text));

    run.status = 'succeeded';
    run.result = envelope.answer;
    run.structuredEvents = envelope.events;
    run.provider = result.provider;
    run.model = result.model;
    run.inputTokens = result.inputTokens;
    run.outputTokens = result.outputTokens;
    run.latencyMs = result.latencyMs;
    run.fallbacks = result.fallbacks;
    memoryUsage.inputTokens += result.inputTokens;
    memoryUsage.outputTokens += result.outputTokens;

    const tokenQuantity = (result.inputTokens || 0) + (result.outputTokens || 0);
    if (tokenQuantity > 0) {
      await recordMeterEvent({
        accountId: run.accountId,
        metricId: BILLABLE_METRICS.AI_TOKENS.id,
        metricVersion: BILLABLE_METRICS.AI_TOKENS.version,
        unit: BILLABLE_METRICS.AI_TOKENS.unit,
        quantity: tokenQuantity,
        sourceId: `${run.id}:ai_tokens`,
        occurredAt: new Date(),
        provenance: { runId: run.id, provider: result.provider, model: result.model }
      });
    }
    await recordMeterEvent({
      accountId: run.accountId,
      metricId: BILLABLE_METRICS.SUCCESSFUL_RUNS.id,
      metricVersion: BILLABLE_METRICS.SUCCESSFUL_RUNS.version,
      unit: BILLABLE_METRICS.SUCCESSFUL_RUNS.unit,
      quantity: 1,
      sourceId: `${run.id}:successful_run`,
      occurredAt: new Date(),
      provenance: { runId: run.id, provider: result.provider, model: result.model }
    });
  } catch (e) {
    run.status = 'failed';
    run.error = stableErrorCode(e, 'PROVIDER_UNAVAILABLE');
    run.fallbacks = Array.isArray(e.diagnostics) ? e.diagnostics : [];
  }

  run.finishedAt = new Date().toISOString();
  run.nextBestAction = deriveNextAction(envelope, run);
  await finishRunRecord(run);
  await recordUsage({
    runId: run.id, provider: run.provider, model: run.model,
    inputTokens: run.inputTokens || 0, outputTokens: run.outputTokens || 0, estimatedCost: 0
  });

  await recordRunLearning({
    taskId: task.id, scenarioId: task.scenarioId || null, runId: run.id,
    result: run.result || run.error, provider: run.provider, model: run.model,
    inputTokens: run.inputTokens || 0, outputTokens: run.outputTokens || 0,
    status: run.status, nextBestAction: run.nextBestAction
  });

  if (run.status === 'succeeded' && envelope) {
    run.learning = await ingestStructuredLearning({
      taskId: task.id,
      scenarioId: task.scenarioId || null,
      runId: run.id,
      envelope
    });
  }

  run.knowledge = await getKnowledgeSnapshot({ taskId: task.id });
  return run;
}

function schedule(task) {
  const old = timers.get(task.id);
  if (old) {
    clearInterval(old);
    timers.delete(task.id);
  }
  if (task.status !== 'active') return;
  const interval = normalizeIntervalMinutes(task.intervalMinutes);
  if (!interval.valid || !interval.value) {
    if (!interval.valid) console.warn(`[Taskman Schedule] ${interval.code}; task=${task.id}`);
    return;
  }
  const timer = setInterval(() => {
    executionTracker.run('task-schedule', signal => executeTask(task, 'schedule', signal))
      .catch(error => logRestrictedError(error, { context: 'task_schedule' }));
  }, interval.value * 60_000);
  timer.unref();
  timers.set(task.id, timer);
}

async function restoreSchedules() {
  const tasks = await listTaskRecords();
  for (const task of tasks) schedule(task);
}

function startBrainScheduler() {
  const interval = normalizeBrainIntervalMinutes(runtimeConfig.scheduler.brainIntervalMinutes || null);
  if (!interval.valid || !interval.value) {
    if (!interval.valid) console.warn(`[Taskman Brain] ${interval.code}; scheduler disabled`);
    return;
  }
  const minutes = interval.value;
  brainTimer = setInterval(() => {
    executionTracker.run('brain-schedule', signal => executeBrainCycle('schedule', { signal }))
      .catch(error => logRestrictedError(error, { context: 'brain_schedule' }));
  }, minutes * 60_000);
  brainTimer.unref();
  console.log(`Taskman brain scheduler enabled: every ${minutes} minute(s)`);
}

async function tickInternalScheduler(signal) {
  if (!runtimeConfig.scheduler.internalEnabled) return;
  const now = new Date();

  for (const scheduleDef of DEFAULT_SCHEDULES) {
    const workerName = scheduleDef.workerName;
    const claim = await claimScheduledJob(scheduleDef.id, {
      now,
      claimedBy: `taskman-internal-scheduler-${process.pid}`
    });

    if (!claim) continue;

    console.log(`[Taskman Scheduler] Claimed scheduled firing for worker: ${workerName} (runKey: ${claim.runKey})`);

    let result = null;
    let error = null;
    const runStarted = Date.now();
    try {
      result = await withTelemetrySpan('scheduler.run', {
        correlation_id: claim.runKey,
        run_key: claim.runKey,
        schedule_id: claim.job.id,
        stage: workerName.toUpperCase(),
        reclaimed: new Date(claim.scheduledFor).getTime() < now.getTime()
      }, async () => {
        const options = {
          claimedBy: claim.claimedBy,
          correlationId: claim.runKey,
          runKey: claim.runKey,
          scheduleId: claim.job.id,
          signal
        };
        if (workerName === 'discover') return runDiscoverWorker(options);
        if (workerName === 'validate') return runValidateWorker(options);
        if (workerName === 'execute') return runExecuteWorker(options);
        throw new Error(`Unknown scheduled worker: ${workerName}`);
      });

      await finishScheduledJobRun({
        jobId: claim.job.id,
        runKey: claim.runKey,
        leaseToken: claim.leaseToken,
        status: 'COMPLETED',
        result,
        now: new Date()
      });
      recordScheduleRun({
        runKey: claim.runKey, scheduleId: claim.job.id, stage: workerName,
        scheduledFor: claim.scheduledFor, outcome: 'COMPLETED',
        durationMs: Date.now() - runStarted,
        reclaimed: new Date(claim.scheduledFor).getTime() < now.getTime()
      });
      console.log(`[Taskman Scheduler] Completed scheduled firing for worker: ${workerName}`);
    } catch (err) {
      const interrupted = signal?.aborted === true;
      const outcome = interrupted ? 'INTERRUPTED' : 'FAILED';
      error = interrupted ? 'SHUTDOWN_INTERRUPTED' : stableErrorCode(err);
      if (interrupted) {
        console.warn(`[Taskman Scheduler] Worker interrupted during shutdown: ${workerName}`);
      } else {
        logRestrictedError(err, { context: `scheduled_worker:${workerName}` });
      }
      await finishScheduledJobRun({
        jobId: claim.job.id,
        runKey: claim.runKey,
        leaseToken: claim.leaseToken,
        status: outcome,
        error,
        now: new Date()
      });
      recordScheduleRun({
        runKey: claim.runKey, scheduleId: claim.job.id, stage: workerName,
        scheduledFor: claim.scheduledFor, outcome,
        durationMs: Date.now() - runStarted,
        reclaimed: new Date(claim.scheduledFor).getTime() < now.getTime()
      });
    }
  }
}

function startInternalSchedulerLoop() {
  if (!runtimeConfig.scheduler.internalEnabled) {
    console.log('[Taskman Scheduler] Internal scheduler loop disabled (TASKMAN_INTERNAL_SCHEDULER_ENABLED != true)');
    return;
  }
  console.log('[Taskman Scheduler] Internal durable scheduler loop enabled. Polling schedule queue every 15s.');
  executionTracker.run('internal-scheduler', signal => tickInternalScheduler(signal))
    .catch(error => logRestrictedError(error, { context: 'scheduler_loop' }));
  internalSchedulerTimer = setInterval(() => {
    executionTracker.run('internal-scheduler', signal => tickInternalScheduler(signal))
      .catch(error => logRestrictedError(error, { context: 'scheduler_loop' }));
  }, 15_000);
  internalSchedulerTimer.unref();
}

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(req, res);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    req.taskmanCorrelationId = requestCorrelationId(req);
    observeApiRequest(req, res, url.pathname);

    if (shutdownCoordinator?.isDraining() && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      res.setHeader('retry-after', String(Math.max(1, Math.ceil(shutdownCoordinator.graceMs / 1000))));
      return sendProblem(res, new AppError('SHUTDOWN_IN_PROGRESS'), { req, context: 'shutdown_drain' });
    }

    if (req.method === 'GET' && url.pathname === '/health/live') {
      return json(res, 200, livenessSnapshot());
    }

    if (req.method === 'GET' && url.pathname === '/health/ready') {
      const database = await dbHealth();
      const health = evaluateHealth({
        database,
        providers: providerStatus(),
        schedulerDurable: isSchedulerDurable(),
        internalSchedulerEnabled: runtimeConfig.scheduler.internalEnabled,
        draining: shutdownCoordinator?.isDraining() === true
      });
      return json(res, health.ready ? 200 : 503, health);
    }

    if (req.method === 'GET' && url.pathname === '/api/observability') {
      return json(res, 200, getObservabilitySnapshot({
        includeTraces: url.searchParams.get('traces') !== 'false'
      }));
    }

    if (req.method === 'GET' && url.pathname === '/api/observability/pipeline') {
      return json(res, 200, await getPipelineObservabilitySummary({
        maxStallMinutes: Number(url.searchParams.get('maxStallMinutes') || 60)
      }));
    }

    if (await handleMoltJobsRequest(req, res, url)) return;
    if (await handleRevenueRequest(req, res, url)) return;
    if (await handleEconomicSelectorRequest(req, res, url)) return;

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const database = await dbHealth();
      const providers = providerStatus();
      const schedulerDurable = isSchedulerDurable();
      const internalSchedulerEnabled = runtimeConfig.scheduler.internalEnabled;
      const brainInterval = normalizeBrainIntervalMinutes(runtimeConfig.scheduler.brainIntervalMinutes || null);
      const health = evaluateHealth({
        database,
        providers,
        schedulerDurable,
        internalSchedulerEnabled,
        draining: shutdownCoordinator?.isDraining() === true
      });
      const usage = databaseEnabled ? await usageSummary() : memoryUsage;
      return json(res, 200, {
        ...health,
        providers,
        usage: { kind: 'operational_non_billable', ...usage },
        metering: { authoritative: true, accountScoped: true, billingExport: billingExportStatus() },
        database,
        structuredLearning: true,
        autonomousBrain: true,
        revenueExplorerQueues: true,
        schedulerDurable,
        internalSchedulerEnabled,
        runtime: {
          nodeVersion: process.versions.node,
          nodeMajor: Number(process.versions.node.split('.')[0]),
          supportedNodeMajor: 24
        },
        brainIntervalMinutes: brainInterval.valid ? brainInterval.value : null,
        configuration: runtimeConfig.safeSummary
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/usage') {
      const accountId = url.searchParams.get('accountId');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!accountId || !from || !to) return json(res, 400, { error: 'accountId, from, and to are required' });
      try {
        return json(res, 200, await accountUsageSummary({
          accountId, from, to,
          limit: url.searchParams.get('limit') || 50,
          cursor: url.searchParams.get('cursor') || null
        }));
      } catch (error) {
        if (error instanceof TypeError) return json(res, 400, { error: error.message });
        throw error;
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/entitlements/check') {
      const accountId = url.searchParams.get('accountId');
      const metricId = url.searchParams.get('metricId');
      if (!accountId || !metricId) return json(res, 400, { error: 'accountId and metricId are required' });
      try {
        return json(res, 200, await checkEntitlement({
          accountId, metricId,
          metricVersion: Number(url.searchParams.get('metricVersion') || 1),
          proposedQuantity: Number(url.searchParams.get('quantity') || 1)
        }));
      } catch (error) {
        if (error instanceof TypeError || String(error.message).startsWith('UNKNOWN_') || String(error.message).includes('MISMATCH')) {
          return json(res, 400, { error: error.message });
        }
        throw error;
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/work/queue') {
      const repo = url.searchParams.get('repo') || process.env.TASKMAN_REPO || 'joyelgeorge/Taskman';
      const status = url.searchParams.get('status') || null;
      return json(res, 200, {
        repo,
        queue: await getActionableWorkQueue({ repo, eligibilityStatus: status })
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/work/sync') {
      const body = await readJsonBody(req).catch(() => ({}));
      const repo = body.repo || url.searchParams.get('repo') || process.env.TASKMAN_REPO || 'joyelgeorge/Taskman';
      const result = await syncGitHubWork({ repo, token: process.env.GITHUB_TOKEN });
      return json(res, 200, result);
    }
    if (req.method === 'GET' && url.pathname === '/api/work/executions') {
      const repo = url.searchParams.get('repo') || process.env.TASKMAN_REPO || 'joyelgeorge/Taskman';
      const issueNumber = url.searchParams.get('issue') ? parseInt(url.searchParams.get('issue'), 10) : null;
      return json(res, 200, {
        repo,
        runs: await listExecutionRuns({ repo, issueNumber })
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/work/dispatch') {
      const body = await readJsonBody(req).catch(() => ({}));
      const repo = body.repo || url.searchParams.get('repo') || process.env.TASKMAN_REPO || 'joyelgeorge/Taskman';
      const claimedWork = await claimActionableWorkItem({ repo, claimedBy: 'api-work-dispatch' });
      if (!claimedWork) {
        return json(res, 200, { ok: false, status: 'NO_ELIGIBLE_WORK', message: 'No eligible unleased work available' });
      }
      // If no backend configured, release and return SETUP_REQUIRED
      await releaseActionableWorkItem({
        repo,
        issueNumber: claimedWork.issueNumber,
        claimedBy: 'api-work-dispatch',
        eligibilityStatus: WORK_ELIGIBILITY.READY,
        eligibilityReason: 'Coding agent backend not configured (SETUP_REQUIRED)'
      });
      return json(res, 200, {
        ok: false,
        status: 'SETUP_REQUIRED',
        issueNumber: claimedWork.issueNumber,
        title: claimedWork.title,
        message: 'No coding agent backend configured to execute work package'
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/merge-train/records') {
      const repo = url.searchParams.get('repo') || process.env.TASKMAN_REPO || 'joyelgeorge/Taskman';
      const status = url.searchParams.get('status') || null;
      return json(res, 200, {
        repo,
        records: await listMergeTrainRecords({ repo, status })
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/merge-train/tick') {
      const body = await readJsonBody(req).catch(() => ({}));
      const repo = body.repo || url.searchParams.get('repo') || process.env.TASKMAN_REPO || 'joyelgeorge/Taskman';
      const result = await processMergeTrainStep({
        repo,
        candidatePrs: body.candidatePrs || [],
        mergePrFn: async ({ prNumber }) => ({ sha: `merge-commit-${prNumber}` })
      });
      return json(res, 200, result);
    }
    if (req.method === 'GET' && url.pathname === '/api/strategic/objectives') {
      const status = url.searchParams.get('status') || null;
      return json(res, 200, { objectives: await listStrategicObjectives({ status }) });
    }
    if (req.method === 'POST' && url.pathname === '/api/strategic/objectives') {
      const body = await readJsonBody(req);
      const objective = await createStrategicObjective(body);
      return json(res, 201, objective);
    }
    const directiveMatch = url.pathname.match(/^\/api\/strategic\/objectives\/([^/]+)\/directives$/);
    if (req.method === 'POST' && directiveMatch) {
      const body = await readJsonBody(req);
      const directive = await addStrategicDirective({ objectiveId: directiveMatch[1], ...body });
      return json(res, 201, directive);
    }
    if (req.method === 'GET' && url.pathname === '/api/strategic/brief') {
      const objectiveId = url.searchParams.get('objectiveId') || null;
      return json(res, 200, await generateStrategicBrief({ objectiveId }));
    }
    if (req.method === 'GET' && url.pathname === '/api/commercial/wedge') {
      return json(res, 200, COMMERCIAL_WEDGE_SPEC);
    }
    if (req.method === 'POST' && url.pathname === '/api/commercial/fiverr/reconcile') {
      const body = await readJsonBody(req).catch(() => ({}));
      const report = reconcileFiverrPayoutBatch(body);
      return json(res, 200, report);
    }
    if (req.method === 'GET' && url.pathname === '/api/commercial/customer-profile') {
      return json(res, 200, FIRST_PAYING_CUSTOMER_PROFILE);
    }
    if (req.method === 'POST' && url.pathname === '/api/commercial/customer/qualify') {
      const body = await readJsonBody(req).catch(() => ({}));
      return json(res, 200, qualifyProspect(body));
    }
    if (req.method === 'GET' && url.pathname === '/api/commercial/stack') {
      return json(res, 200, {
        config: MINIMUM_STACK_CONFIG,
        readiness: verifyCustomerStackReady()
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/commercial/customer/workflow') {
      return json(res, 200, getCustomerWorkflowState());
    }
    if (req.method === 'POST' && url.pathname === '/api/commercial/customer/workflow/configure') {
      const body = await readJsonBody(req).catch(() => ({}));
      return json(res, 200, configureCustomerWorkflow(body));
    }
    if (req.method === 'POST' && url.pathname === '/api/commercial/customer/workflow/integration') {
      const body = await readJsonBody(req).catch(() => ({}));
      return json(res, 200, setCustomerIntegration(body));
    }
    if (req.method === 'POST' && url.pathname === '/api/commercial/customer/workflow/status') {
      const body = await readJsonBody(req).catch(() => ({}));
      try {
        return json(res, 200, setCustomerWorkflowActive(Boolean(body.active)));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/commercial/customer/workflow/reconcile') {
      const body = await readJsonBody(req).catch(() => ({}));
      try {
        return json(res, 200, executeCustomerReconciliation(body));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/commercial/billing/rules') {
      return json(res, 200, BILLING_RULES);
    }
    if (req.method === 'GET' && url.pathname === '/api/commercial/billing/events') {
      const accountId = url.searchParams.get('accountId') || null;
      return json(res, 200, getAccountBillableEvents(accountId));
    }
    if (req.method === 'POST' && url.pathname === '/api/commercial/billing/calculate') {
      const body = await readJsonBody(req).catch(() => ({}));
      try {
        return json(res, 200, calculateValueLinkedBilling(body));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/commercial/billing/transition') {
      const body = await readJsonBody(req).catch(() => ({}));
      try {
        return json(res, 200, transitionInvoiceCommercialState(body));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/commercial/template') {
      return json(res, 200, REUSABLE_CUSTOMER_TEMPLATE_SPEC);
    }
    if (req.method === 'GET' && url.pathname === '/api/commercial/template/instances') {
      return json(res, 200, listCustomerInstances());
    }
    if (req.method === 'POST' && url.pathname === '/api/commercial/template/instances') {
      const body = await readJsonBody(req).catch(() => ({}));
      try {
        return json(res, 201, instantiateCustomerTemplate(body));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/commercial/acquisition/channel') {
      return json(res, 200, PRIMARY_ACQUISITION_CHANNEL);
    }
    if (req.method === 'GET' && url.pathname === '/api/commercial/acquisition/metrics') {
      return json(res, 200, getFunnelMetrics());
    }
    if (req.method === 'POST' && url.pathname === '/api/commercial/acquisition/prospects') {
      const body = await readJsonBody(req).catch(() => ({}));
      try {
        return json(res, 201, recordProspect(body));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/commercial/acquisition/prospects/advance') {
      const body = await readJsonBody(req).catch(() => ({}));
      try {
        return json(res, 200, advanceProspectStage(body));
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/tasks') return json(res, 200, await listTaskRecords());
    if (req.method === 'GET' && url.pathname === '/api/runs') return json(res, 200, await listRunRecords(50));
    if (req.method === 'GET' && url.pathname === '/api/scenarios') return json(res, 200, await listScenarios());
    if (req.method === 'GET' && url.pathname === '/api/brain') return json(res, 200, await getBrainState());

    // The only endpoint that reports money. Everything else reports estimates.
    if (req.method === 'GET' && url.pathname === '/api/money/economics') {
      return json(res, 200, { rails: await railEconomics(), asOf: new Date().toISOString() });
    }

    const railViabilityMatch = url.pathname.match(/^\/api\/money\/rails\/([^/]+)\/viability$/);
    if (req.method === 'GET' && railViabilityMatch) {
      const rail = decodeURIComponent(railViabilityMatch[1]);
      return json(res, 200, { ...(await evaluateRailViability({ rail })), state: await getRailState(rail) });
    }

    const railEnableMatch = url.pathname.match(/^\/api\/money\/rails\/([^/]+)\/enabled$/);
    if (req.method === 'POST' && railEnableMatch) {
      const body = await readBody(req);
      if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled (boolean) is required' });
      const rail = decodeURIComponent(railEnableMatch[1]);
      return json(res, 200, await setRailEnabled(rail, body.enabled, body.reason || 'disabled manually'));
    }

    if (req.method === 'POST' && url.pathname === '/api/money/settlements/sync') {
      const body = await readBody(req);
      if (!body.rail) return json(res, 400, { error: 'rail is required' });
      if (!process.env.STRIPE_API_KEY) return json(res, 400, { error: 'STRIPE_API_KEY is not configured' });
      try {
        return json(res, 200, await syncStripeSettlements({ rail: body.rail, since: body.since || null }));
      } catch (error) {
        return json(res, 502, { error: String(error.message || error) });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/brain/cycles') return json(res, 200, await listBrainCycles(50));
    if (req.method === 'POST' && url.pathname === '/api/brain/run') {
      return idempotentJson(req, res, {
        route: url.pathname,
        execute: () => executionTracker.run(
          'brain-manual',
          signal => executeBrainCycle('manual', { signal })
        )
      });
    }

    const scenarioKnowledgeMatch = url.pathname.match(/^\/api\/scenarios\/([^/]+)\/knowledge$/);
    if (req.method === 'GET' && scenarioKnowledgeMatch) {
      return json(res, 200, await getKnowledgeSnapshot({ scenarioId: scenarioKnowledgeMatch[1] }));
    }

    const knowledgeMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/knowledge$/);
    if (req.method === 'GET' && knowledgeMatch) return json(res, 200, await getKnowledgeSnapshot({ taskId: knowledgeMatch[1] }));

    if (req.method === 'POST' && url.pathname === '/api/tasks') {
      const body = await readJsonBody(req);
      if (!body.prompt?.trim()) {
        return sendProblem(res, new AppError('INVALID_REQUEST'), { req, context: 'create_task' });
      }
      const accountId = body.accountId?.trim() || process.env.TASKMAN_DEFAULT_ACCOUNT_ID ||
        (process.env.NODE_ENV === 'production' ? null : 'local-default');
      if (!accountId) {
        return sendProblem(res, new AppError('INVALID_REQUEST', 'accountId is required'), { req, context: 'create_task_account' });
      }
      const interval = normalizeIntervalMinutes(body.intervalMinutes);
      if (!interval.valid) {
        return sendProblem(res, new AppError(interval.code), { req, context: 'create_task_interval' });
      }
      return idempotentJson(req, res, {
        route: url.pathname,
        body,
        successStatus: 201,
        execute: async () => {
          const task = await createTaskRecord({
            id: crypto.randomUUID(),
            accountId,
            scenarioId: body.scenarioId || null,
            title: body.title?.trim() || body.prompt.trim().slice(0, 60),
            prompt: body.prompt.trim(),
            intervalMinutes: interval.value
          });
          schedule(task);
          return task;
        }
      });
    }

    const runMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
    if (req.method === 'POST' && runMatch) {
      const task = await getTaskRecord(runMatch[1]);
      if (!task) return sendProblem(res, new AppError('NOT_FOUND'), { req, context: 'run_task' });
      return idempotentJson(req, res, {
        route: url.pathname,
        execute: () => executionTracker.run(
          'task-manual',
          signal => executeTask(task, 'manual', signal)
        )
      });
    }

    const pauseMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/pause$/);
    if (req.method === 'POST' && pauseMatch) {
      return idempotentJson(req, res, {
        route: url.pathname,
        execute: async () => {
          const task = await toggleTaskStatus(pauseMatch[1]);
          if (!task) throw new AppError('NOT_FOUND');
          schedule(task);
          return task;
        }
      });
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(join(publicDir, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      const js = await readFile(join(publicDir, 'app.js'));
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(js);
    }
    if (req.method === 'GET' && url.pathname === '/refresh-controller.js') {
      const js = await readFile(join(publicDir, 'refresh-controller.js'));
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(js);
    }
    if (req.method === 'GET' && url.pathname === '/styles.css') {
      const css = await readFile(join(publicDir, 'styles.css'));
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      return res.end(css);
    }
    sendProblem(res, new AppError('NOT_FOUND'), { req, context: 'route' });
  } catch (e) {
    sendProblem(res, e, { req, context: 'request' });
  }
});

configureServerTimeouts(server);

function stopScheduling() {
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();
  if (brainTimer) clearInterval(brainTimer);
  if (internalSchedulerTimer) clearInterval(internalSchedulerTimer);
  brainTimer = null;
  internalSchedulerTimer = null;
}

shutdownCoordinator = createShutdownCoordinator({
  server,
  tracker: executionTracker,
  stopScheduling,
  closeDatabase: async () => {
    if (pool && !pool.ended) await pool.end();
  }
});
installShutdownSignals(shutdownCoordinator);

if (databaseEnabled) {
  const migration = await migrate();
  await initializeMetering();
  const scenarios = await seedScenarios();
  const tasks = await seedCoreTasks();
  const intervalQuarantine = await quarantineInvalidIntervalTriggers();
  await initializeScheduler();
  const overdue = await reconcileOverdueJobs();
  console.log('Taskman database ready', { migration, scenarios, tasks, intervalQuarantine, overdueCount: overdue.length });
} else {
  await initializeMetering();
  await initializeScheduler();
}
await restoreSchedules();
startBrainScheduler();
startInternalSchedulerLoop();
console.log('[Taskman Configuration]', runtimeConfig.safeSummary);
server.listen(port, () => console.log(`Taskman running at http://localhost:${port}`));
