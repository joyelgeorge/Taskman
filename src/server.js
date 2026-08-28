import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { providerStatus, runWithFallback } from './providers.js';
import { getKnowledgeSnapshot, recordRunLearning } from './knowledge-store.js';
import { databaseEnabled, migrate, healthCheck as dbHealth } from './db.js';
import { seedScenarios, listScenarios } from './scenario-store.js';
import {
  createTaskRecord, listTaskRecords, getTaskRecord, toggleTaskStatus,
  createRunRecord, finishRunRecord, listRunRecords, recordUsage, usageSummary
} from './task-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const port = Number(process.env.PORT || 3000);
const timers = new Map();
const memoryUsage = { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function nextAction(task, run, knowledge) {
  if (run.status === 'failed') return 'Resolve the failure cause before repeating the same route.';
  if (knowledge?.latestFuturePath?.value?.nextBestAction) return knowledge.latestFuturePath.value.nextBestAction;
  if (task.intervalMinutes) return 'Use this run to identify the next unresolved money-relevant gap, then make the next run attack that gap.';
  return 'Review the result and define the next unresolved gap.';
}

function compactKnowledge(knowledge) {
  return {
    knownFacts: knowledge.knownFacts.slice(-8).map(e => e.value ?? e.summary ?? e),
    rejectedPaths: knowledge.rejectedPaths.slice(-8).map(e => e.value ?? e.summary ?? e),
    openGaps: knowledge.openGaps.slice(-5).map(e => e.gap ?? e.value ?? e),
    latestFuturePath: knowledge.latestFuturePath?.value || null
  };
}

async function executeTask(task, reason = 'manual') {
  const run = {
    id: crypto.randomUUID(), taskId: task.id, scenarioId: task.scenarioId || null,
    reason, status: 'running', startedAt: new Date().toISOString()
  };
  await createRunRecord(run);

  const knowledgeBefore = await getKnowledgeSnapshot({ taskId: task.id });
  try {
    const context = compactKnowledge(knowledgeBefore);
    const prompt = `${task.prompt}\n\nCurrent durable task knowledge:\n${JSON.stringify(context)}\n\nInstruction: focus only on the most valuable unresolved gap. Do not repeat rejected paths. Return evidence or an actionable step that moves toward the task's measurable outcome.`;
    const result = await runWithFallback(prompt);
    run.status = 'succeeded';
    run.result = result.text;
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
  run.nextBestAction = nextAction(task, run, knowledgeBefore);
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const db = await dbHealth();
      const usage = databaseEnabled ? await usageSummary() : memoryUsage;
      return json(res, 200, { providers: providerStatus(), usage, database: db });
    }
    if (req.method === 'GET' && url.pathname === '/api/tasks') return json(res, 200, await listTaskRecords());
    if (req.method === 'GET' && url.pathname === '/api/runs') return json(res, 200, await listRunRecords(50));
    if (req.method === 'GET' && url.pathname === '/api/scenarios') return json(res, 200, await listScenarios());

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
  const seeded = await seedScenarios();
  console.log('Taskman database ready', { migration, seeded });
}
await restoreSchedules();
server.listen(port, () => console.log(`Taskman running at http://localhost:${port}`));
