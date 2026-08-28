import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { providerStatus, runWithFallback } from './providers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const port = Number(process.env.PORT || 3000);

const state = { tasks: [], runs: [], usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 } };
const timers = new Map();

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function nextAction(task, run) {
  if (run.status === 'failed') return 'Check provider credentials or retry after the provider recovers.';
  if (task.intervalMinutes) return `Review the next scheduled result in about ${task.intervalMinutes} minute(s).`;
  return 'Review the result and convert it into a recurring task if repetition would be useful.';
}

async function executeTask(task, reason = 'manual') {
  const run = { id: crypto.randomUUID(), taskId: task.id, reason, status: 'running', startedAt: new Date().toISOString() };
  state.runs.unshift(run);
  try {
    const history = state.runs.filter(r => r.taskId === task.id && r.status === 'succeeded' && r.result).slice(0, 3)
      .map(r => r.result).join('\n\n');
    const prompt = history ? `${task.prompt}\n\nRecent task context:\n${history}` : task.prompt;
    const result = await runWithFallback(prompt);
    run.status = 'succeeded';
    run.result = result.text;
    run.provider = result.provider;
    run.model = result.model;
    run.inputTokens = result.inputTokens;
    run.outputTokens = result.outputTokens;
    run.latencyMs = result.latencyMs;
    run.fallbacks = result.fallbacks;
    state.usage.inputTokens += result.inputTokens;
    state.usage.outputTokens += result.outputTokens;
    task.lastResult = result.text;
    task.lastRunAt = new Date().toISOString();
  } catch (e) {
    run.status = 'failed';
    run.error = String(e.message || e);
  }
  run.finishedAt = new Date().toISOString();
  run.nextBestAction = nextAction(task, run);
  return run;
}

function schedule(task) {
  const old = timers.get(task.id);
  if (old) clearInterval(old);
  if (!task.intervalMinutes || task.status !== 'active') return;
  const timer = setInterval(() => executeTask(task, 'schedule'), task.intervalMinutes * 60_000);
  timer.unref();
  timers.set(task.id, timer);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { providers: providerStatus(), usage: state.usage });
    if (req.method === 'GET' && url.pathname === '/api/tasks') return json(res, 200, state.tasks);
    if (req.method === 'GET' && url.pathname === '/api/runs') return json(res, 200, state.runs.slice(0, 50));

    if (req.method === 'POST' && url.pathname === '/api/tasks') {
      const body = await readBody(req);
      if (!body.prompt?.trim()) return json(res, 400, { error: 'prompt is required' });
      const task = {
        id: crypto.randomUUID(),
        title: body.title?.trim() || body.prompt.trim().slice(0, 60),
        prompt: body.prompt.trim(),
        intervalMinutes: Number(body.intervalMinutes || 0) || null,
        status: 'active',
        createdAt: new Date().toISOString()
      };
      state.tasks.unshift(task);
      schedule(task);
      return json(res, 201, task);
    }

    const runMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
    if (req.method === 'POST' && runMatch) {
      const task = state.tasks.find(t => t.id === runMatch[1]);
      if (!task) return json(res, 404, { error: 'task not found' });
      return json(res, 200, await executeTask(task));
    }

    const pauseMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/pause$/);
    if (req.method === 'POST' && pauseMatch) {
      const task = state.tasks.find(t => t.id === pauseMatch[1]);
      if (!task) return json(res, 404, { error: 'task not found' });
      task.status = task.status === 'active' ? 'paused' : 'active';
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

server.listen(port, () => console.log(`Taskman running at http://localhost:${port}`));
