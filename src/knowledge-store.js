import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const STORE_PATH = process.env.TASKMAN_KNOWLEDGE_PATH || 'data/runtime/knowledge-events.jsonl';

async function ensureStore() {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  try { await readFile(STORE_PATH, 'utf8'); } catch { await writeFile(STORE_PATH, '', 'utf8'); }
}

export async function appendKnowledgeEvent(event) {
  await ensureStore();
  const record = {
    id: crypto.randomUUID(),
    observedAt: new Date().toISOString(),
    confidence: 0.5,
    sourceType: 'system',
    ...event
  };
  await writeFile(STORE_PATH, JSON.stringify(record) + '\n', { encoding: 'utf8', flag: 'a' });
  return record;
}

export async function readKnowledgeEvents({ scenarioId, taskId } = {}) {
  await ensureStore();
  const raw = await readFile(STORE_PATH, 'utf8');
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(e => {
    if (scenarioId && e.scenarioId !== scenarioId) return false;
    if (taskId && e.taskId !== taskId) return false;
    return true;
  });
}

export function buildKnowledgeSnapshot(events) {
  const snapshot = {
    knownFacts: [],
    activeAssumptions: [],
    rejectedPaths: [],
    resolvedGaps: [],
    openGaps: [],
    moneyEvents: [],
    providerObservations: [],
    latestFuturePath: null
  };

  for (const e of events) {
    if (e.type === 'fact') snapshot.knownFacts.push(e);
    if (e.type === 'assumption') snapshot.activeAssumptions.push(e);
    if (e.type === 'rejection') snapshot.rejectedPaths.push(e);
    if (e.type === 'gap_resolved') snapshot.resolvedGaps.push(e);
    if (e.type === 'gap_opened') snapshot.openGaps.push(e);
    if (e.type === 'money_event') snapshot.moneyEvents.push(e);
    if (e.type === 'provider_observation') snapshot.providerObservations.push(e);
    if (e.type === 'future_path') snapshot.latestFuturePath = e;
  }

  const resolved = new Set(snapshot.resolvedGaps.map(e => e.gap));
  snapshot.openGaps = snapshot.openGaps.filter(e => !resolved.has(e.gap));
  return snapshot;
}

export async function getKnowledgeSnapshot(filter = {}) {
  return buildKnowledgeSnapshot(await readKnowledgeEvents(filter));
}

export async function recordRunLearning({ taskId, scenarioId, runId, result, provider, model, inputTokens = 0, outputTokens = 0, status, nextBestAction }) {
  const events = [];

  events.push(await appendKnowledgeEvent({
    type: 'run_observation', taskId, scenarioId, runId, status,
    value: { result, nextBestAction }, sourceType: 'execution', confidence: status === 'succeeded' ? 0.7 : 0.5
  }));

  if (provider) {
    events.push(await appendKnowledgeEvent({
      type: 'provider_observation', taskId, scenarioId, runId,
      value: { provider, model, inputTokens, outputTokens, success: status === 'succeeded' },
      sourceType: 'execution', confidence: 1
    }));
  }

  if (nextBestAction) {
    events.push(await appendKnowledgeEvent({
      type: 'future_path', taskId, scenarioId, runId,
      value: { nextBestAction }, sourceType: 'inference', confidence: 0.55
    }));
  }

  return events;
}
