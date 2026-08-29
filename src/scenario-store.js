import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { databaseEnabled, query, withTransaction } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedPath = join(__dirname, '..', 'data', 'scenarios.json');
const moneyFlowHistoryPath = join(__dirname, '..', 'data', 'money-flow-search-history.json');

export async function loadScenarioSeed() {
  try {
    return JSON.parse(await readFile(seedPath, 'utf8'));
  } catch {
    return { scenarios: [] };
  }
}

async function loadMoneyFlowHistorySeed() {
  return JSON.parse(await readFile(moneyFlowHistoryPath, 'utf8'));
}

function seedMetadata(seed) {
  return {
    schemaVersion: Number(seed.schema_version || 1),
    updatedAt: seed.updated_at || null,
    source: 'data/scenarios.json'
  };
}

function previousSeedVersion(data) {
  return Number(data?._seed?.schemaVersion || 0);
}

export async function seedScenarios() {
  const db = await loadScenarioSeed();
  if (!databaseEnabled) return { enabled: false, count: db.scenarios?.length || 0 };

  const metadata = seedMetadata(db);
  let inserted = 0;
  let updated = 0;
  let preserved = 0;

  for (const s of db.scenarios || []) {
    const existing = await query('SELECT data FROM scenarios WHERE id = $1', [s.id]);
    const incomingData = { ...s, _seed: metadata };

    if (!existing.rowCount) {
      await query(
        `INSERT INTO scenarios (id, name, category, status, goal, data, evidence_strength, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,now())`,
        [s.id, s.name, s.category, s.status, s.goal || null, JSON.stringify(incomingData), s.evidence_strength ?? 0.5]
      );
      inserted++;
      continue;
    }

    // Apply a repository seed only once per schema version. Unknown/evolved DB-only
    // fields survive, while fields explicitly changed in a newer seed become current.
    if (previousSeedVersion(existing.rows[0].data) < metadata.schemaVersion) {
      const mergedData = { ...existing.rows[0].data, ...incomingData };
      await query(
        `UPDATE scenarios
         SET name=$2, category=$3, status=$4, goal=$5, data=$6::jsonb,
             evidence_strength=$7, updated_at=now()
         WHERE id=$1`,
        [s.id, s.name, s.category, s.status, s.goal || null, JSON.stringify(mergedData), s.evidence_strength ?? 0.5]
      );
      updated++;
    } else {
      preserved++;
    }
  }

  return {
    enabled: true,
    inserted,
    updated,
    preserved,
    seedSchemaVersion: metadata.schemaVersion
  };
}

function coreTaskDefinition(scenarioSeed, historySeed) {
  const scenario = (scenarioSeed.scenarios || []).find(s => s.id === historySeed.scenario_id);
  if (!scenario) return null;

  return {
    scenarioId: historySeed.scenario_id,
    title: historySeed.task.title,
    objective: historySeed.task.objective,
    status: historySeed.task.status || 'active',
    sourcePrompt: historySeed.task.objective,
    plan: {
      stableKey: historySeed.task.stable_key,
      mode: historySeed.task.mode,
      thresholdCrossed: scenario.current_leader?.freeze_threshold_crossed ?? historySeed.task.threshold_crossed,
      currentBestPath: scenario.current_best_path || null,
      currentLeader: scenario.current_leader || null,
      currentRankedCandidates: scenario.current_ranked_candidates || [],
      latestResearchRun: scenario.latest_research_run || null
    },
    policy: {
      operatingProtocol: historySeed.operating_protocol,
      decisionProtocol: scenarioSeed.decision_protocol,
      acceptanceGates: scenario.acceptance_gates || [],
      scoringRubric: scenario.scoring_rubric || null
    }
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]));
  }
  return value;
}

function jsonEqual(left, right) {
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

export async function seedCoreTasks() {
  const [scenarioSeed, historySeed] = await Promise.all([loadScenarioSeed(), loadMoneyFlowHistorySeed()]);
  const definition = coreTaskDefinition(scenarioSeed, historySeed);
  if (!definition) return { enabled: databaseEnabled, inserted: 0, updated: 0, reason: 'core scenario missing' };
  if (!databaseEnabled) return { enabled: false, count: 1 };

  const existing = await query(
    `SELECT t.id, t.current_version, t.objective, t.status,
            tv.source_prompt, tv.plan, tv.policy
     FROM tasks t
     LEFT JOIN task_versions tv ON tv.task_id=t.id AND tv.version=t.current_version
     WHERE t.scenario_id=$1 AND t.title=$2
     ORDER BY t.created_at ASC LIMIT 1`,
    [definition.scenarioId, definition.title]
  );

  if (!existing.rowCount) {
    const taskId = await withTransaction(async client => {
      const insertedTask = await client.query(
        `INSERT INTO tasks (scenario_id, title, objective, status, current_version)
         VALUES ($1,$2,$3,$4,1) RETURNING id`,
        [definition.scenarioId, definition.title, definition.objective, definition.status]
      );
      const id = insertedTask.rows[0].id;
      await client.query(
        `INSERT INTO task_versions (task_id, version, source_prompt, plan, policy)
         VALUES ($1,1,$2,$3::jsonb,$4::jsonb)`,
        [id, definition.sourcePrompt, JSON.stringify(definition.plan), JSON.stringify(definition.policy)]
      );
      return id;
    });
    return { enabled: true, inserted: 1, updated: 0, taskId, version: 1 };
  }

  const current = existing.rows[0];
  const definitionChanged = current.source_prompt !== definition.sourcePrompt
    || !jsonEqual(current.plan || {}, definition.plan)
    || !jsonEqual(current.policy || {}, definition.policy);
  const taskChanged = current.objective !== definition.objective || current.status !== definition.status;

  if (!definitionChanged && !taskChanged) {
    return { enabled: true, inserted: 0, updated: 0, taskId: current.id, version: current.current_version };
  }

  const version = await withTransaction(async client => {
    let nextVersion = Number(current.current_version || 0);
    if (definitionChanged) {
      nextVersion += 1;
      await client.query(
        `INSERT INTO task_versions (task_id, version, source_prompt, plan, policy)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)`,
        [current.id, nextVersion, definition.sourcePrompt, JSON.stringify(definition.plan), JSON.stringify(definition.policy)]
      );
    }
    await client.query(
      `UPDATE tasks SET objective=$2, status=$3, current_version=$4, updated_at=now() WHERE id=$1`,
      [current.id, definition.objective, definition.status, nextVersion]
    );
    return nextVersion;
  });

  return { enabled: true, inserted: 0, updated: 1, taskId: current.id, version };
}

export async function listScenarios() {
  if (!databaseEnabled) return (await loadScenarioSeed()).scenarios || [];
  const result = await query('SELECT data FROM scenarios ORDER BY updated_at DESC');
  return result.rows.map(r => r.data);
}

export async function getScenario(id) {
  if (!databaseEnabled) return ((await loadScenarioSeed()).scenarios || []).find(s => s.id === id) || null;
  const result = await query('SELECT data FROM scenarios WHERE id = $1', [id]);
  return result.rows[0]?.data || null;
}
