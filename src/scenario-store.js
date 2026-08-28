import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { databaseEnabled, query } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedPath = join(__dirname, '..', 'data', 'scenarios.json');

export async function loadScenarioSeed() {
  return JSON.parse(await readFile(seedPath, 'utf8'));
}

export async function seedScenarios() {
  const db = await loadScenarioSeed();
  if (!databaseEnabled) return { enabled: false, count: db.scenarios?.length || 0 };

  let count = 0;
  for (const s of db.scenarios || []) {
    await query(
      `INSERT INTO scenarios (id, name, category, status, goal, data, evidence_strength, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         status = EXCLUDED.status,
         goal = EXCLUDED.goal,
         data = EXCLUDED.data,
         evidence_strength = EXCLUDED.evidence_strength,
         updated_at = now()`,
      [s.id, s.name, s.category, s.status, s.goal || null, JSON.stringify(s), s.evidence_strength ?? 0.5]
    );
    count++;
  }

  return { enabled: true, count };
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
