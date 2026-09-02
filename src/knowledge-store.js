import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { databaseEnabled, query } from './db.js';
import { getRuntimeConfig } from './config.js';

const STORE_PATH = getRuntimeConfig().knowledgePath;

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

async function persistMoneyEvent({ taskId, scenarioId, runId, event }) {
  if (!databaseEnabled || !event.money) return null;
  const m = event.money;
  const result = await query(
    `INSERT INTO money_events
     (scenario_id, task_id, run_id, event_type, amount, currency, attributable_value, confidence, evidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
    [scenarioId || null, taskId || null, runId || null, m.eventType,
     Number.isFinite(m.amount) ? m.amount : null, m.currency || null,
     Number.isFinite(m.attributableValue) ? m.attributableValue : null,
     event.confidence, JSON.stringify(m.evidence || { summary: event.summary })]
  );
  return result.rows[0];
}

async function persistFuturePath({ taskId, scenarioId, runId, event }) {
  if (!databaseEnabled || event.type !== 'future_path') return null;
  const result = await query(
    `INSERT INTO future_paths
     (scenario_id, task_id, based_on_run_id, next_strategy, next_questions, next_experiments)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb) RETURNING *`,
    [scenarioId || null, taskId || null, runId || null,
     JSON.stringify({ nextBestAction: event.value?.nextBestAction, summary: event.summary }),
     JSON.stringify(event.value?.nextQuestions || []), JSON.stringify(event.value?.nextExperiments || [])]
  );
  return result.rows[0];
}

export async function ingestStructuredLearning({ taskId, scenarioId, runId, envelope }) {
  const stored = [];
  for (const event of envelope.events) {
    const record = await appendKnowledgeEvent({
      taskId, scenarioId, runId,
      type: event.type,
      key: event.key,
      value: event.value,
      sourceType: event.sourceType,
      confidence: event.confidence,
      metadata: { ...event.metadata, summary: event.summary, structured: true }
    });
    stored.push(record);
    if (event.type === 'money_event') await persistMoneyEvent({ taskId, scenarioId, runId, event });
    if (event.type === 'future_path') await persistFuturePath({ taskId, scenarioId, runId, event });
  }

  const allEvents = await readKnowledgeEvents({ taskId });
  const snapshot = buildKnowledgeSnapshot(allEvents);
  await persistKnowledgeSnapshot({ scenarioId, taskId, runId, snapshot, eventCount: allEvents.length });
  return { events: stored, snapshot };
}

export async function recordRunLearning({ taskId, scenarioId, runId, result, provider, model, inputTokens = 0, outputTokens = 0, status, nextBestAction }) {
  const events = [];

  events.push(await appendKnowledgeEvent({
    type: 'run_observation', taskId, scenarioId, runId,
    value: { result, nextBestAction, status }, sourceType: 'execution', confidence: status === 'succeeded' ? 0.7 : 0.5
  }));

  if (provider) {
    events.push(await appendKnowledgeEvent({
      type: 'provider_observation', taskId, scenarioId, runId,
      value: { provider, model, inputTokens, outputTokens, success: status === 'succeeded' },
      sourceType: 'execution', confidence: 1
    }));
  }

  const allEvents = await readKnowledgeEvents({ taskId });
  const snapshot = buildKnowledgeSnapshot(allEvents);
  await persistKnowledgeSnapshot({ scenarioId, taskId, runId, snapshot, eventCount: allEvents.length });
  return events;
}
