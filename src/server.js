import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { providerStatus, runWithFallback } from './providers.js';
import { getKnowledgeSnapshot, recordRunLearning, ingestStructuredLearning } from './knowledge-store.js';
import { buildLearningPrompt, parseLearningEnvelope, validateLearningEnvelope } from './structured-learning.js';
import { databaseEnabled, migrate, healthCheck as dbHealth } from './db.js';
import { seedScenarios, seedCoreTasks, listScenarios } from './scenario-store.js';
import { getBrainState, executeBrainCycle, listBrainCycles } from './brain-controller.js';
import { handleMoltJobsRequest } from './moltjobs-routes.js';
import { handleRevenueRequest } from './revenue-routes.js';
import {
  createTaskRecord, listTaskRecords, getTaskRecord, toggleTaskStatus,
  createRunRecord, finishRunRecord, listRunRecords, recordUsage, usageSummary
} from './task-store.js';
import {
  initializeScheduler, reconcileOverdueJobs, claimScheduledJob, isSchedulerDurable, DEFAULT_SCHEDULES
} from './durable-scheduler.js';
import { runClaimedSchedule } from './scheduled-runner.js';
import { runDiscoverWorker } from './workers/discover.js';
import { runValidateWorker } from './workers/validate.js';
import { runExecuteWorker } from './workers/execute.js';

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

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
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
    const result = await runWithFallback(prompt);
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
    run.error = String(e.message || e);
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
  if (old) clearInterval(old);
  if (!task.intervalMinutes || task.status !== 'active') return;
  const timer = setInterval(() => executeTask(task, 'schedule').catch(console.error), task.intervalMinutes * 60_000);
  timer.unref();
  timers.set(task.id, timer);
}

async function restoreSchedules() {
  const tasks = await listTaskRecords();
  for (const task of tasks) schedule(task);
}

function startBrainScheduler() {
  const minutes = Number(process.env.TASKMAN_BRAIN_INTERVAL_MINUTES || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  brainTimer = setInterval(() => executeBrainCycle('schedule').catch(console.error), minutes * 60_000);
  brainTimer.unref();
  console.log(`Taskman brain scheduler enabled: every ${minutes} minute(s)`);
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

    const outcome = await runClaimedSchedule({
      claim,
      workerName,
      runWorker: async ({ claimedBy }) => {
        if (workerName === 'discover') return runDiscoverWorker({ claimedBy });
        if (workerName === 'validate') return runValidateWorker({ claimedBy });
        if (workerName === 'execute') return runExecuteWorker({ claimedBy });
        throw new Error(`Unknown scheduled worker: ${workerName}`);
      }
    });

    if (!outcome.ok) {
      console.warn(`[Taskman Scheduler] Fenced completion for worker: ${workerName}`, outcome.finishResult);
    } else if (outcome.error) {
      console.error(`[Taskman Scheduler] Worker failed: ${workerName}`, outcome.error);
    } else {
      console.log(`[Taskman Scheduler] Completed scheduled firing for worker: ${workerName}`);
    }
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
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (await handleMoltJobsRequest(req, res, url)) return;
    if (await handleRevenueRequest(req, res, url)) return;

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const db = await dbHealth();
      const usage = databaseEnabled ? await usageSummary() : memoryUsage;
      return json(res, 200, {
        providers: providerStatus(), usage, database: db,
        structuredLearning: true,
        autonomousBrain: true,
        revenueExplorerQueues: true,
        schedulerDurable: isSchedulerDurable(),
        internalSchedulerEnabled: process.env.TASKMAN_INTERNAL_SCHEDULER_ENABLED === 'true',
        brainIntervalMinutes: Number(process.env.TASKMAN_BRAIN_INTERVAL_MINUTES || 0) || null
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
      const body = await readBody(req);
      if (!body.prompt?.trim()) return json(res, 400, { error: 'prompt is required' });
      const id = crypto.randomUUID();
      const task = await createTaskRecord({
        id,
        scenarioId: body.scenarioId || null,
        title: body.title?.trim() || body.prompt.trim().slice(0, 60),
        prompt: body.prompt.trim(),
        intervalMinutes: Number(body.intervalMinutes || 0) || null
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
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

if (databaseEnabled) {
  const migration = await migrate();
  const scenarios = await seedScenarios();
  const tasks = await seedCoreTasks();
  await initializeScheduler();
  const overdue = await reconcileOverdueJobs();
  console.log('Taskman database ready', { migration, scenarios, tasks, overdueCount: overdue.length });
} else {
  await initializeScheduler();
}
await restoreSchedules();
startBrainScheduler();
startInternalSchedulerLoop();
server.listen(port, () => console.log(`Taskman running at http://localhost:${port}`));