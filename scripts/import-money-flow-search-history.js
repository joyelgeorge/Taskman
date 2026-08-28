import fs from 'node:fs/promises';
import path from 'node:path';
import { databaseEnabled, migrate, query, pool } from '../src/db.js';

if (!databaseEnabled) {
  console.error('DATABASE_URL is required to import money-flow search history.');
  process.exit(1);
}

await migrate();

const filePath = path.join(process.cwd(), 'data', 'money-flow-search-history.json');
const seed = JSON.parse(await fs.readFile(filePath, 'utf8'));
const scenarioId = seed.scenario_id;

const scenarioExists = await query('SELECT id FROM scenarios WHERE id = $1', [scenarioId]);
if (!scenarioExists.rowCount) {
  await query(
    `INSERT INTO scenarios (id, name, category, status, goal, data, evidence_strength)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      scenarioId,
      'Programmable money-flow opportunity search',
      'core_search_strategy',
      'active',
      seed.task.objective,
      JSON.stringify({ importedFrom: 'data/money-flow-search-history.json', operating_protocol: seed.operating_protocol }),
      0.99
    ]
  );
}

let task = await query(
  `SELECT id, current_version FROM tasks
   WHERE scenario_id = $1 AND title = $2
   ORDER BY created_at ASC LIMIT 1`,
  [scenarioId, seed.task.title]
);

let taskId;
if (!task.rowCount) {
  const inserted = await query(
    `INSERT INTO tasks (scenario_id, title, objective, status, current_version)
     VALUES ($1,$2,$3,$4,1)
     RETURNING id`,
    [scenarioId, seed.task.title, seed.task.objective, seed.task.status || 'active']
  );
  taskId = inserted.rows[0].id;

  await query(
    `INSERT INTO task_versions (task_id, version, source_prompt, plan, policy)
     VALUES ($1,1,$2,$3::jsonb,$4::jsonb)`,
    [
      taskId,
      'Imported Money Flow Wedge Scout protocol from conversation/GitHub anchor.',
      JSON.stringify({ mode: seed.task.mode, thresholdCrossed: seed.task.threshold_crossed }),
      JSON.stringify(seed.operating_protocol)
    ]
  );
} else {
  taskId = task.rows[0].id;
  await query(
    `UPDATE tasks SET objective = $2, status = $3, updated_at = now() WHERE id = $1`,
    [taskId, seed.task.objective, seed.task.status || 'active']
  );
}

async function insertKnowledgeOnce(type, key, value, confidence = 0.9, metadata = {}) {
  const existing = await query(
    `SELECT id FROM knowledge_events
     WHERE scenario_id = $1 AND task_id = $2 AND type = $3 AND key = $4
     LIMIT 1`,
    [scenarioId, taskId, type, key]
  );
  if (existing.rowCount) return false;

  await query(
    `INSERT INTO knowledge_events
      (scenario_id, task_id, type, key, value, source_type, confidence, metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb,'conversation_history',$6,$7::jsonb)`,
    [scenarioId, taskId, type, key, JSON.stringify(value), confidence, JSON.stringify(metadata)]
  );
  return true;
}

let insertedEvents = 0;
for (const event of seed.conversation_history || []) {
  insertedEvents += Number(await insertKnowledgeOnce(
    event.type || 'fact',
    `conversation:${event.seq}`,
    event,
    0.95,
    { importedFrom: 'data/money-flow-search-history.json', seq: event.seq }
  ));
}

for (const [index, rejected] of (seed.known_rejected_or_demoted || []).entries()) {
  insertedEvents += Number(await insertKnowledgeOnce(
    'rejection',
    `rejected:${index}`,
    { summary: rejected, terminal: true },
    0.94,
    { importedFrom: 'data/money-flow-search-history.json' }
  ));
}

insertedEvents += Number(await insertKnowledgeOnce(
  'fact',
  'current:leader',
  seed.current_leader,
  0.9,
  { importedFrom: 'data/money-flow-search-history.json', mutableCurrentState: true }
));

insertedEvents += Number(await insertKnowledgeOnce(
  'fact',
  'current:operating_protocol',
  seed.operating_protocol,
  0.99,
  { importedFrom: 'data/money-flow-search-history.json' }
));

const latestRun = await query(
  `SELECT id FROM runs
   WHERE task_id = $1 AND trigger_reason = 'historical_anchor_import'
   ORDER BY created_at DESC LIMIT 1`,
  [taskId]
);

let runId;
if (!latestRun.rowCount) {
  const insertedRun = await query(
    `INSERT INTO runs
      (task_id, task_version, scenario_id, trigger_reason, status, result, started_at, finished_at)
     VALUES ($1,1,$2,'historical_anchor_import','completed',$3::jsonb,now(),now())
     RETURNING id`,
    [taskId, scenarioId, JSON.stringify({
      mode: seed.task.mode,
      thresholdCrossed: seed.task.threshold_crossed,
      currentLeader: seed.current_leader,
      importedAt: seed.updated_at
    })]
  );
  runId = insertedRun.rows[0].id;
} else {
  runId = latestRun.rows[0].id;
}

const snapshotExists = await query(
  `SELECT id FROM knowledge_snapshots WHERE task_id = $1 AND run_id = $2 LIMIT 1`,
  [taskId, runId]
);
if (!snapshotExists.rowCount) {
  await query(
    `INSERT INTO knowledge_snapshots (scenario_id, task_id, run_id, snapshot, event_count)
     VALUES ($1,$2,$3,$4::jsonb,$5)`,
    [scenarioId, taskId, runId, JSON.stringify(seed), insertedEvents]
  );
}

const strategyExists = await query(
  `SELECT id FROM strategy_events
   WHERE task_id = $1 AND strategy_id = 'money-flow-search' AND action = 'anchor_import'
   LIMIT 1`,
  [taskId]
);
if (!strategyExists.rowCount) {
  await query(
    `INSERT INTO strategy_events
      (scenario_id, task_id, run_id, strategy_id, action, score_after, reason)
     VALUES ($1,$2,$3,'money-flow-search','anchor_import',$4,$5::jsonb)`,
    [
      scenarioId,
      taskId,
      runId,
      seed.current_leader?.score ?? null,
      JSON.stringify({
        summary: 'Imported evolving conversation/search state into Taskman DB anchor.',
        currentLeader: seed.current_leader?.name,
        thresholdCrossed: seed.task.threshold_crossed
      })
    ]
  );
}

console.log(JSON.stringify({
  scenarioId,
  taskId,
  runId,
  insertedEvents,
  currentLeader: seed.current_leader?.name,
  score: seed.current_leader?.score,
  thresholdCrossed: seed.task.threshold_crossed
}, null, 2));

await pool.end();
