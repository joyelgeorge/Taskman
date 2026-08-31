import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { providerStatus, runWithFallback } from './providers.js';
import { LIMITS, configureServerTimeouts, readJsonBody } from './limits.js';
import { getKnowledgeSnapshot, recordRunLearning, ingestStructuredLearning } from './knowledge-store.js';
import { buildLearningPrompt, parseLearningEnvelope, validateLearningEnvelope } from './structured-learning.js';
import { databaseEnabled, migrate, healthCheck as dbHealth } from './db.js';
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
import { applySecurityHeaders } from './http-security.js';
import {
  CONCURRENCY_POLICY,
  executeBrainWithConcurrencyPolicy,
  executeWithConcurrencyPolicy,
  getConcurrencyStatus,
  normalizeConcurrencyPolicy
} from './scheduler-concurrency.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const port = Number(process.env.PORT || 3000);
const timers = new Map();
const memoryUsage = { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
let brainTimer = null;
let internalSchedulerTimer = null;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
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

async function executeTask(task, reason = 'manual') {
  const run = {
    id: crypto.randomUUID(), taskId: task.id, scenarioId: task.scenarioId || null,
    reason, status: 'running', startedAt: new Date().toISOString()
  };
  await createRunRecord(run);

  const knowledgeBefore = await getKnowledgeSnapshot({ taskId: task.id });
  let envelope = null;
  try {
    const prompt = buildLearningPrompt({ objective: task.prompt, context: compactKnowledge(knowledgeBefore) });
    const result = await runWithFallback(prompt, { runTimeoutMs: LIMITS.runTimeoutMs });
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
  } catch (e) {
    run.status = 'failed';
    run.error = e.code || 'PROVIDER_ERROR';
    run.errorDetail = String(e.message || e);
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

async function recordScheduledConcurrencyOutcome(task, outcome) {
  if (!['SKIPPED', 'COALESCED'].includes(outcome.outcome)) return;
  const now = new Date().toISOString();
  const run = {
    id: crypto.randomUUID(),
    taskId: task.id,
    scenarioId: task.scenarioId || null,
    reason: `schedule:${outcome.outcome.toLowerCase()}`,
    status: outcome.outcome.toLowerCase(),
    startedAt: now,
    finishedAt: now,
    result: outcome.reason || outcome.outcome,
    nextBestAction: outcome.outcome === 'COALESCED'
      ? 'Run the single retained firing after the active run finishes.'
      : 'Wait for the active run to finish before the next scheduled firing.'
  };
  await createRunRecord(run);
  await finishRunRecord(run);
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
  const policy = normalizeConcurrencyPolicy(task.concurrencyPolicy, { allowConcurrent: true });
  const timer = setInterval(() => executeWithConcurrencyPolicy(
    `task:${task.id}`,
    ({ queued }) => executeTask(task, queued ? 'schedule:queued' : 'schedule'),
    {
      policy,
      allowConcurrent: policy === CONCURRENCY_POLICY.ALLOW,
      onOutcome: async outcome => {
        if (['SKIPPED', 'COALESCED'].includes(outcome.outcome)) {
          console.log('[Taskman Schedule] concurrency outcome', outcome);
          await recordScheduledConcurrencyOutcome(task, outcome);
        }
      }
    }
  ).catch(console.error), interval.value * 60_000);
  timer.unref();
  timers.set(task.id, timer);
}

async function restoreSchedules() {
  const tasks = await listTaskRecords();
  for (const task of tasks) schedule(task);
}

function startBrainScheduler() {
  const interval = normalizeBrainIntervalMinutes();
  if (!interval.valid || !interval.value) {
    if (!interval.valid) console.warn(`[Taskman Brain] ${interval.code}; scheduler disabled`);
    return;
  }
  const minutes = interval.value;
  const requestedPolicy = String(process.env.TASKMAN_BRAIN_CONCURRENCY_POLICY || CONCURRENCY_POLICY.FORBID).toUpperCase();
  const policy = normalizeConcurrencyPolicy(requestedPolicy, {
    allowConcurrent: requestedPolicy === CONCURRENCY_POLICY.ALLOW
  });
  brainTimer = setInterval(() => executeBrainWithConcurrencyPolicy(
    ({ queued }) => executeBrainCycle(queued ? 'schedule:queued' : 'schedule'),
    { policy, allowConcurrent: policy === CONCURRENCY_POLICY.ALLOW }
  ).catch(console.error), minutes * 60_000);
  brainTimer.unref();
  console.log(`Taskman brain scheduler enabled: every ${minutes} minute(s), concurrency=${policy}`);
}

async function tickInternalScheduler() {
  if (process.env.TASKMAN_INTERNAL_SCHEDULER_ENABLED !== 'true') return;
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
    try {
      if (workerName === 'discover') result = await runDiscoverWorker({ claimedBy: claim.claimedBy });
      else if (workerName === 'validate') result = await runValidateWorker({ claimedBy: claim.claimedBy });
      else if (workerName === 'execute') result = await runExecuteWorker({ claimedBy: claim.claimedBy });

      await finishScheduledJobRun({
        jobId: claim.job.id,
        runKey: claim.runKey,
        leaseToken: claim.leaseToken,
        status: 'COMPLETED',
        result,
        now: new Date()
      });
      console.log(`[Taskman Scheduler] Completed scheduled firing for worker: ${workerName}`);
    } catch (err) {
      error = err.message;
      console.error(`[Taskman Scheduler] Error in worker ${workerName}:`, err);
      await finishScheduledJobRun({
        jobId: claim.job.id,
        runKey: claim.runKey,
        leaseToken: claim.leaseToken,
        status: 'FAILED',
        error,
        now: new Date()
      });
    }
  }
}

function startInternalSchedulerLoop() {
  if (process.env.TASKMAN_INTERNAL_SCHEDULER_ENABLED !== 'true') {
    console.log('[Taskman Scheduler] Internal scheduler loop disabled (TASKMAN_INTERNAL_SCHEDULER_ENABLED != true)');
    return;
  }
  console.log('[Taskman Scheduler] Internal durable scheduler loop enabled. Polling schedule queue every 15s.');
  tickInternalScheduler().catch(console.error);
  internalSchedulerTimer = setInterval(() => tickInternalScheduler().catch(console.error), 15_000);
  internalSchedulerTimer.unref();
}

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(req, res);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/health/live') {
      return json(res, 200, livenessSnapshot());
    }

    if (req.method === 'GET' && url.pathname === '/health/ready') {
      const database = await dbHealth();
      const health = evaluateHealth({
        database,
        providers: providerStatus(),
        schedulerDurable: isSchedulerDurable(),
        internalSchedulerEnabled: process.env.TASKMAN_INTERNAL_SCHEDULER_ENABLED === 'true'
      });
      return json(res, health.ready ? 200 : 503, health);
    }

    if (await handleMoltJobsRequest(req, res, url)) return;
    if (await handleRevenueRequest(req, res, url)) return;

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const database = await dbHealth();
      const providers = providerStatus();
      const schedulerDurable = isSchedulerDurable();
      const internalSchedulerEnabled = process.env.TASKMAN_INTERNAL_SCHEDULER_ENABLED === 'true';
      const brainInterval = normalizeBrainIntervalMinutes();
      const health = evaluateHealth({
        database,
        providers,
        schedulerDurable,
        internalSchedulerEnabled
      });
      const usage = databaseEnabled ? await usageSummary() : memoryUsage;
      return json(res, 200, {
        ...health,
        providers, usage, database,
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
        brainIntervalMinutes: brainInterval.valid ? brainInterval.value : null
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/scheduler/concurrency') {
      return json(res, 200, {
        defaultPolicy: CONCURRENCY_POLICY.FORBID,
        executions: getConcurrencyStatus()
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/tasks') return json(res, 200, await listTaskRecords());
    if (req.method === 'GET' && url.pathname === '/api/runs') return json(res, 200, await listRunRecords(50));
    if (req.method === 'GET' && url.pathname === '/api/scenarios') return json(res, 200, await listScenarios());
    if (req.method === 'GET' && url.pathname === '/api/brain') return json(res, 200, await getBrainState());
    if (req.method === 'GET' && url.pathname === '/api/brain/cycles') return json(res, 200, await listBrainCycles(50));
    if (req.method === 'POST' && url.pathname === '/api/brain/run') return json(res, 200, await executeBrainCycle('manual'));

    const scenarioKnowledgeMatch = url.pathname.match(/^\/api\/scenarios\/([^/]+)\/knowledge$/);
    if (req.method === 'GET' && scenarioKnowledgeMatch) {
      return json(res, 200, await getKnowledgeSnapshot({ scenarioId: scenarioKnowledgeMatch[1] }));
    }

    const knowledgeMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/knowledge$/);
    if (req.method === 'GET' && knowledgeMatch) return json(res, 200, await getKnowledgeSnapshot({ taskId: knowledgeMatch[1] }));

    if (req.method === 'POST' && url.pathname === '/api/tasks') {
      const body = await readJsonBody(req);
      if (!body.prompt?.trim()) return json(res, 400, { error: 'prompt is required' });
      const interval = normalizeIntervalMinutes(body.intervalMinutes);
      if (!interval.valid) {
        return json(res, 400, {
          error: 'invalid intervalMinutes',
          code: interval.code,
          detail: interval.error
        });
      }
      const requestedPolicy = String(body.concurrencyPolicy || CONCURRENCY_POLICY.FORBID).trim().toUpperCase();
      let concurrencyPolicy;
      try {
        concurrencyPolicy = normalizeConcurrencyPolicy(requestedPolicy, {
          allowConcurrent: requestedPolicy === CONCURRENCY_POLICY.ALLOW
        });
      } catch (error) {
        return json(res, 400, { error: error.message, code: error.code });
      }
      const id = crypto.randomUUID();
      const task = await createTaskRecord({
        id,
        scenarioId: body.scenarioId || null,
        title: body.title?.trim() || body.prompt.trim().slice(0, 60),
        prompt: body.prompt.trim(),
        intervalMinutes: interval.value,
        concurrencyPolicy
      });
      schedule(task);
      return json(res, 201, task);
    }

    const runMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
    if (req.method === 'POST' && runMatch) {
      const task = await getTaskRecord(runMatch[1]);
      if (!task) return json(res, 404, { error: 'task not found' });
      return json(res, 200, await executeTask(task));
    }

    const pauseMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/pause$/);
    if (req.method === 'POST' && pauseMatch) {
      const task = await toggleTaskStatus(pauseMatch[1]);
      if (!task) return json(res, 404, { error: 'task not found' });
      schedule(task);
      return json(res, 200, task);
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
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, e.statusCode || 500, {
      error: String(e.message || e),
      code: e.code || 'INTERNAL_ERROR'
    });
  }
});

configureServerTimeouts(server);

if (databaseEnabled) {
  const migration = await migrate();
  const scenarios = await seedScenarios();
  const tasks = await seedCoreTasks();
  const intervalQuarantine = await quarantineInvalidIntervalTriggers();
  await initializeScheduler();
  const overdue = await reconcileOverdueJobs();
  console.log('Taskman database ready', { migration, scenarios, tasks, intervalQuarantine, overdueCount: overdue.length });
} else {
  await initializeScheduler();
}
await restoreSchedules();
startBrainScheduler();
startInternalSchedulerLoop();
server.listen(port, () => console.log(`Taskman running at http://localhost:${port}`));
