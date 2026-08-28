import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { databaseEnabled, query } from './db.js';

const STORE_PATH = process.env.TASKMAN_KNOWLEDGE_PATH || 'data/runtime/knowledge-events.jsonl';

async function ensureStore() {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  try { await readFile(STORE_PATH, 'utf8'); } catch { await writeFile(STORE_PATH, '', 'utf8'); }
}

function dbRowToEvent(row) {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    taskId: row.task_id,
    runId: row.run_id,
    type: row.type,
    key: row.key,
    value: row.value,
    sourceType: row.source_type,
    confidence: Number(row.confidence),
    observedAt: row.observed_at,
    metadata: row.metadata || {}
  };
}

export async function appendKnowledgeEvent(event) {
  const record = {
    id: crypto.randomUUID(),
    observedAt: new Date().toISOString(),
    confidence: 0.5,
    sourceType: 'system',
    metadata: {},
    ...event
  };

  if (databaseEnabled) {
    const result = await query(
      `INSERT INTO knowledge_events
       (id, scenario_id, task_id, run_id, type, key, value, source_type, confidence, observed_at, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb)
       RETURNING *`,
      [record.id, record.scenarioId || null, record.taskId || null, record.runId || null,
       record.type, record.key || null, JSON.stringify(record.value ?? {}), record.sourceType,
       record.confidence, record.observedAt, JSON.stringify(record.metadata || {})]
    );
    return dbRowToEvent(result.rows[0]);
  }

  await ensureStore();
  await writeFile(STORE_PATH, JSON.stringify(record) + '\n', { encoding: 'utf8', flag: 'a' });
  return record;
}

export async function readKnowledgeEvents({ scenarioId, taskId } = {}) {
  if (databaseEnabled) {
    const clauses = [];
    const params = [];
    if (scenarioId) { params.push(scenarioId); clauses.push(`scenario_id = $${params.length}`); }
    if (taskId) { params.push(taskId); clauses.push(`task_id = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await query(`SELECT * FROM knowledge_events ${where} ORDER BY observed_at ASC`, params);
    return result.rows.map(dbRowToEvent);
  }

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

  const resolved = new Set(snapshot.resolvedGaps.map(e => e.gap || e.value?.gap));
  snapshot.openGaps = snapshot.openGaps.filter(e => !resolved.has(e.gap || e.value?.gap));
  return snapshot;
}

export async function getKnowledgeSnapshot(filter = {}) {
  return buildKnowledgeSnapshot(await readKnowledgeEvents(filter));
}

export async function persistKnowledgeSnapshot({ scenarioId, taskId, runId, snapshot, eventCount }) {
  if (!databaseEnabled) return null;
  const result = await query(
    `INSERT INTO knowledge_snapshots (scenario_id, task_id, run_id, snapshot, event_count)
     VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *`,
    [scenarioId || null, taskId || null, runId || null, JSON.stringify(snapshot), eventCount || 0]
  );
  return result.rows[0];
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

  const allEvents = await readKnowledgeEvents({ taskId });
  const snapshot = buildKnowledgeSnapshot(allEvents);
  await persistKnowledgeSnapshot({ scenarioId, taskId, runId, snapshot, eventCount: allEvents.length });

  return events;
}
