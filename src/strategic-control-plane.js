import { databaseEnabled, query, withTransaction } from './db.js';
import { railEconomics } from './money-ledger.js';

const objectivesMemoryStore = new Map(); // id -> objective
const directivesMemoryStore = new Map(); // objectiveId -> array of directives

export const OBJECTIVE_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  BLOCKED: 'BLOCKED'
});

/**
 * Creates a durable strategic objective.
 */
export async function createStrategicObjective({
  id = `obj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  title,
  desiredOutcome,
  priority = 100,
  budgetCents = 0,
  constraints = {},
  successMetrics = [],
  killCriteria = [],
  approvalBoundaries = {}
}) {
  if (!title || !desiredOutcome) throw new Error('title and desiredOutcome are required');

  const record = {
    id,
    title,
    desiredOutcome,
    priority,
    status: OBJECTIVE_STATUS.ACTIVE,
    budgetCents,
    spentCents: 0,
    constraints,
    successMetrics,
    killCriteria,
    approvalBoundaries,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!databaseEnabled) {
    objectivesMemoryStore.set(id, { ...record });
    directivesMemoryStore.set(id, []);
    return record;
  }

  await query(`
    INSERT INTO strategic_objectives (
      id, title, desired_outcome, priority, status, budget_cents, spent_cents,
      constraints, success_metrics, kill_criteria, approval_boundaries, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, now())
  `, [
    record.id, record.title, record.desiredOutcome, record.priority, record.status,
    record.budgetCents, record.spentCents, JSON.stringify(record.constraints),
    JSON.stringify(record.successMetrics), JSON.stringify(record.killCriteria),
    JSON.stringify(record.approvalBoundaries), record.createdAt
  ]);

  return record;
}

/**
 * Adds a versioned strategic directive from human or strategic AI supervisor.
 */
export async function addStrategicDirective({
  objectiveId,
  author = 'human',
  directiveText,
  rationale = '',
  updatedPriority,
  updatedConstraints
}) {
  if (!objectiveId || !directiveText) throw new Error('objectiveId and directiveText are required');

  const obj = await getStrategicObjective(objectiveId);
  if (!obj) throw new Error(`Objective ${objectiveId} not found`);

  let nextVersion = 1;
  if (!databaseEnabled) {
    const list = directivesMemoryStore.get(objectiveId) || [];
    nextVersion = list.length + 1;
    const directive = {
      id: `dir-${objectiveId}-v${nextVersion}`,
      objectiveId,
      version: nextVersion,
      author,
      directiveText,
      rationale,
      appliedAt: new Date().toISOString()
    };
    list.push(directive);
    directivesMemoryStore.set(objectiveId, list);

    if (updatedPriority !== undefined) obj.priority = updatedPriority;
    if (updatedConstraints) obj.constraints = { ...obj.constraints, ...updatedConstraints };
    obj.updatedAt = new Date().toISOString();
    objectivesMemoryStore.set(objectiveId, obj);

    return directive;
  }

  return withTransaction(async client => {
    const vRes = await client.query('SELECT COALESCE(MAX(version), 0) + 1 AS next_ver FROM strategic_directives WHERE objective_id = $1', [objectiveId]);
    nextVersion = vRes.rows[0].next_ver;

    const directiveId = `dir-${objectiveId}-v${nextVersion}`;
    const insRes = await client.query(`
      INSERT INTO strategic_directives (id, objective_id, version, author, directive_text, rationale, applied_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      RETURNING *
    `, [directiveId, objectiveId, nextVersion, author, directiveText, rationale]);

    let updateSql = 'UPDATE strategic_objectives SET updated_at = now()';
    const params = [objectiveId];
    let pIdx = 2;

    if (updatedPriority !== undefined) {
      updateSql += `, priority = $${pIdx++}`;
      params.push(updatedPriority);
    }
    if (updatedConstraints) {
      updateSql += `, constraints = constraints || $${pIdx++}::jsonb`;
      params.push(JSON.stringify(updatedConstraints));
    }
    updateSql += ' WHERE id = $1';
    await client.query(updateSql, params);

    const r = insRes.rows[0];
    return {
      id: r.id,
      objectiveId: r.objective_id,
      version: r.version,
      author: r.author,
      directiveText: r.directive_text,
      rationale: r.rationale,
      appliedAt: r.applied_at
    };
  });
}

export async function getStrategicObjective(id) {
  if (!databaseEnabled) {
    const o = objectivesMemoryStore.get(id);
    return o ? { ...o } : null;
  }
  const res = await query('SELECT * FROM strategic_objectives WHERE id = $1', [id]);
  if (!res.rows[0]) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    title: r.title,
    desiredOutcome: r.desired_outcome,
    priority: r.priority,
    status: r.status,
    budgetCents: r.budget_cents,
    spentCents: r.spent_cents,
    constraints: r.constraints,
    successMetrics: r.success_metrics,
    killCriteria: r.kill_criteria,
    approvalBoundaries: r.approval_boundaries,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export async function listStrategicObjectives({ status } = {}) {
  if (!databaseEnabled) {
    let list = Array.from(objectivesMemoryStore.values());
    if (status) list = list.filter(o => o.status === status);
    return list.sort((a, b) => b.priority - a.priority);
  }

  let sql = 'SELECT * FROM strategic_objectives';
  const params = [];
  if (status) {
    sql += ' WHERE status = $1';
    params.push(status);
  }
  sql += ' ORDER BY priority DESC, created_at ASC';
  const res = await query(sql, params);
  return res.rows.map(r => ({
    id: r.id,
    title: r.title,
    desiredOutcome: r.desired_outcome,
    priority: r.priority,
    status: r.status,
    budgetCents: r.budget_cents,
    spentCents: r.spent_cents,
    constraints: r.constraints,
    successMetrics: r.success_metrics,
    killCriteria: r.kill_criteria,
    approvalBoundaries: r.approval_boundaries,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

/**
 * Generates a bounded strategic brief for AI or human supervisors.
 * Excludes raw logs and returns progress, verified economics, blockers, and recommendations.
 */
export async function generateStrategicBrief({ objectiveId = null } = {}) {
  const objectives = objectiveId
    ? [await getStrategicObjective(objectiveId)].filter(Boolean)
    : await listStrategicObjectives({ status: OBJECTIVE_STATUS.ACTIVE });

  const economics = await railEconomics();
  let totalClearedCents = 0;
  for (const r of Object.values(economics)) {
    totalClearedCents += r.clearedCents || 0;
  }

  const brief = {
    asOf: new Date().toISOString(),
    activeObjectivesCount: objectives.length,
    totalVerifiedRevenue: `$${(totalClearedCents / 100).toFixed(2)}`,
    objectives: objectives.map(o => ({
      id: o.id,
      title: o.title,
      priority: o.priority,
      status: o.status,
      budgetAllocated: `$${(o.budgetCents / 100).toFixed(2)}`,
      budgetSpent: `$${(o.spentCents / 100).toFixed(2)}`,
      constraints: o.constraints,
      killCriteria: o.killCriteria
    })),
    activeBlockers: [],
    recommendedActions: [
      'Maintain autonomous execution on top priority ready items',
      'Review pending approval boundary changes if any are flagged'
    ]
  };

  return brief;
}

export function resetStrategicMemory() {
  objectivesMemoryStore.clear();
  directivesMemoryStore.clear();
}
