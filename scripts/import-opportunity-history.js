import { databaseEnabled, migrate, query, pool } from '../src/db.js';
import { loadScenarioSeed } from '../src/scenario-store.js';

if (!databaseEnabled) {
  console.error('DATABASE_URL is required to import opportunity history.');
  process.exit(1);
}

await migrate();
const seed = await loadScenarioSeed();

async function insertEventOnce({ scenarioId, type, key, value, sourceType, confidence = 0.8, metadata = {} }) {
  const existing = await query(
    `SELECT id FROM knowledge_events
     WHERE scenario_id = $1 AND task_id IS NULL AND run_id IS NULL
       AND type = $2 AND key = $3 AND source_type = $4
     LIMIT 1`,
    [scenarioId, type, key, sourceType]
  );
  if (existing.rowCount) return false;

  await query(
    `INSERT INTO knowledge_events
      (scenario_id, type, key, value, source_type, confidence, metadata)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb)`,
    [scenarioId, type, key, JSON.stringify(value), sourceType, confidence, JSON.stringify(metadata)]
  );
  return true;
}

let scenariosInserted = 0;
let scenariosMerged = 0;
let eventsInserted = 0;

for (const scenario of seed.scenarios || []) {
  const exists = await query('SELECT id FROM scenarios WHERE id = $1', [scenario.id]);

  if (!exists.rowCount) {
    await query(
      `INSERT INTO scenarios (id, name, category, status, goal, data, evidence_strength, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,now())`,
      [scenario.id, scenario.name, scenario.category, scenario.status, scenario.goal || null,
       JSON.stringify(scenario), scenario.evidence_strength ?? 0.5]
    );
    scenariosInserted++;
  } else {
    // Baseline history fills missing fields; existing/evolved DB fields remain authoritative.
    await query(
      `UPDATE scenarios
       SET data = $2::jsonb || data,
           updated_at = now()
       WHERE id = $1`,
      [scenario.id, JSON.stringify(scenario)]
    );
    scenariosMerged++;
  }

  const confidence = Number(scenario.evidence_strength ?? 0.8);
  const sourceType = 'historical_baseline';

  if (scenario.decision) {
    eventsInserted += Number(await insertEventOnce({
      scenarioId: scenario.id,
      type: 'fact',
      key: 'baseline:decision',
      value: { decision: scenario.decision, status: scenario.status, summary: `Historical decision: ${scenario.decision}` },
      sourceType,
      confidence,
      metadata: { importedFrom: 'data/scenarios.json', schemaVersion: seed.schema_version }
    }));
  }

  for (const [index, reason] of (scenario.rejection_reasons || []).entries()) {
    eventsInserted += Number(await insertEventOnce({
      scenarioId: scenario.id,
      type: 'rejection',
      key: `baseline:rejection:${index}`,
      value: {
        summary: reason,
        terminal: scenario.status === 'rejected',
        reuseRule: scenario.reuse_rule || null,
        failedDimensions: scenario.failed_dimensions || null,
        gates: scenario.gates || null
      },
      sourceType,
      confidence,
      metadata: { importedFrom: 'data/scenarios.json', historical: true }
    }));
  }

  for (const [index, failure] of (scenario.observed_failures || []).entries()) {
    eventsInserted += Number(await insertEventOnce({
      scenarioId: scenario.id,
      type: 'fact',
      key: `baseline:observed_failure:${index}`,
      value: { summary: failure, kind: 'observed_failure' },
      sourceType,
      confidence,
      metadata: { importedFrom: 'data/scenarios.json', historical: true }
    }));
  }

  for (const [index, gap] of (scenario.next_gaps || []).entries()) {
    eventsInserted += Number(await insertEventOnce({
      scenarioId: scenario.id,
      type: 'gap_opened',
      key: `baseline:gap:${index}`,
      value: { gap, summary: gap, seeded: true },
      sourceType,
      confidence: Math.min(confidence, 0.85),
      metadata: { importedFrom: 'data/scenarios.json', historical: true }
    }));
  }

  if (scenario.known_data) {
    eventsInserted += Number(await insertEventOnce({
      scenarioId: scenario.id,
      type: 'fact',
      key: 'baseline:known_data',
      value: { summary: 'Structured historical operating data', data: scenario.known_data },
      sourceType,
      confidence,
      metadata: { importedFrom: 'data/scenarios.json', historical: true }
    }));
  }

  if (scenario.gates) {
    eventsInserted += Number(await insertEventOnce({
      scenarioId: scenario.id,
      type: 'fact',
      key: 'baseline:gate_result',
      value: { summary: 'Historical gate evaluation', gates: scenario.gates },
      sourceType,
      confidence,
      metadata: { importedFrom: 'data/scenarios.json', historical: true }
    }));
  }
}

console.log(JSON.stringify({
  schemaVersion: seed.schema_version,
  scenariosInserted,
  scenariosMerged,
  eventsInserted,
  totalScenarios: (seed.scenarios || []).length
}, null, 2));

await pool.end();
