import { databaseEnabled, query, withTransaction } from './db.js';

const memory = { tasks: [], runs: [] };

function rowToTask(row) {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    title: row.title,
    prompt: row.source_prompt || row.objective,
    intervalMinutes: row.interval_seconds ? Math.round(row.interval_seconds / 60) : null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at || null,
    lastResult: row.last_result || null
  };
}

import { normalizeIntervalMinutes } from './interval-validator.js';

export async function createTaskRecord({ id, scenarioId, title, prompt, intervalMinutes }) {
  const norm = normalizeIntervalMinutes(intervalMinutes);
  if (!norm.valid) throw new Error(norm.error);
  const canonicalInterval = norm.value;

  if (!databaseEnabled) {
    const task = { id, scenarioId, title, prompt, intervalMinutes: canonicalInterval, status: 'active', createdAt: new Date().toISOString() };
    memory.tasks.unshift(task);
    return task;
  }

  return withTransaction(async client => {
    const taskResult = await client.query(
      `INSERT INTO tasks (id, scenario_id, title, objective, status, current_version)
       VALUES ($1,$2,$3,$4,'active',1) RETURNING *`,
      [id, scenarioId || null, title, prompt]
    );

    await client.query(
      `INSERT INTO task_versions (task_id, version, source_prompt, plan, policy)
       VALUES ($1,1,$2,'{}'::jsonb,'{}'::jsonb)`,
      [id, prompt]
    );

    if (canonicalInterval) {
      await client.query(
        `INSERT INTO triggers (task_id, type, interval_seconds, timezone, next_fire_at, enabled)
         VALUES ($1,'interval',$2,'Asia/Kolkata',now() + ($2 || ' seconds')::interval,TRUE)`,
        [id, canonicalInterval * 60]
      );
    }

    return rowToTask({ ...taskResult.rows[0], source_prompt: prompt, interval_seconds: canonicalInterval ? canonicalInterval * 60 : null });
  });
}

export async function listTaskRecords() {
  if (!databaseEnabled) return memory.tasks;
  const result = await query(`
    SELECT t.*, tv.source_prompt, tr.interval_seconds,
      lr.finished_at AS last_run_at,
      lr.result->>'text' AS last_result
    FROM tasks t
    JOIN task_versions tv ON tv.task_id = t.id AND tv.version = t.current_version
    LEFT JOIN LATERAL (
      SELECT interval_seconds FROM triggers WHERE task_id=t.id AND enabled=TRUE ORDER BY created_at DESC LIMIT 1
    ) tr ON TRUE
    LEFT JOIN LATERAL (
      SELECT finished_at, result FROM runs WHERE task_id=t.id ORDER BY created_at DESC LIMIT 1
    ) lr ON TRUE
    ORDER BY t.created_at DESC
  `);
  return result.rows.map(rowToTask);
}

export async function getTaskRecord(id) {
  if (!databaseEnabled) return memory.tasks.find(t => t.id === id) || null;
  const result = await query(`
    SELECT t.*, tv.source_prompt, tr.interval_seconds
    FROM tasks t
    JOIN task_versions tv ON tv.task_id=t.id AND tv.version=t.current_version
    LEFT JOIN LATERAL (
      SELECT interval_seconds FROM triggers WHERE task_id=t.id AND enabled=TRUE ORDER BY created_at DESC LIMIT 1
    ) tr ON TRUE
    WHERE t.id=$1
  `, [id]);
  return result.rows[0] ? rowToTask(result.rows[0]) : null;
}

export async function toggleTaskStatus(id) {
  if (!databaseEnabled) {
    const task = memory.tasks.find(t => t.id === id);
    if (!task) return null;
    task.status = task.status === 'active' ? 'paused' : 'active';
    return task;
  }
  const result = await query(`
    UPDATE tasks SET status = CASE WHEN status='active' THEN 'paused' ELSE 'active' END, updated_at=now()
    WHERE id=$1 RETURNING status
  `, [id]);
  if (!result.rowCount) return null;
  await query('UPDATE triggers SET enabled=$2, updated_at=now() WHERE task_id=$1', [id, result.rows[0].status === 'active']);
  return getTaskRecord(id);
}

export async function createRunRecord({ id, taskId, scenarioId, reason, status, startedAt }) {
  if (!databaseEnabled) {
    const run = { id, taskId, scenarioId, reason, status, startedAt };
    memory.runs.unshift(run);
    return run;
  }
  const task = await query('SELECT current_version FROM tasks WHERE id=$1', [taskId]);
  const version = task.rows[0]?.current_version || 1;
  await query(
    `INSERT INTO runs (id, task_id, task_version, scenario_id, trigger_reason, status, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, taskId, version, scenarioId || null, reason, status, startedAt]
  );
  return { id, taskId, scenarioId, reason, status, startedAt };
}

export async function finishRunRecord(run) {
  if (!databaseEnabled) {
    const existing = memory.runs.find(r => r.id === run.id);
    if (existing) Object.assign(existing, run);
    return run;
  }
  const resultJson = run.result ? { text: run.result, nextBestAction: run.nextBestAction, provider: run.provider, model: run.model } : null;
  await query(
    `UPDATE runs SET status=$2, result=$3::jsonb, error_code=$4, finished_at=$5 WHERE id=$1`,
    [run.id, run.status, JSON.stringify(resultJson), run.error || null, run.finishedAt]
  );
  return run;
}

export async function listRunRecords(limit = 50) {
  if (!databaseEnabled) return memory.runs.slice(0, limit);
  const result = await query(`
    SELECT id, task_id, scenario_id, trigger_reason, status, result, error_code, started_at, finished_at
    FROM runs ORDER BY created_at DESC LIMIT $1
  `, [limit]);
  return result.rows.map(r => ({
    id: r.id,
    taskId: r.task_id,
    scenarioId: r.scenario_id,
    reason: r.trigger_reason,
    status: r.status,
    result: r.result?.text || null,
    nextBestAction: r.result?.nextBestAction || null,
    provider: r.result?.provider || null,
    model: r.result?.model || null,
    error: r.error_code,
    startedAt: r.started_at,
    finishedAt: r.finished_at
  }));
}

export async function recordUsage({ runId, provider, model, inputTokens = 0, outputTokens = 0, estimatedCost = 0 }) {
  if (!databaseEnabled || !provider) return;
  await query(`
    INSERT INTO providers (id, adapter_type, display_name, enabled)
    VALUES ($1,'builtin',$1,TRUE)
    ON CONFLICT (id) DO NOTHING
  `, [provider]);
  await query(`
    INSERT INTO usage_events (run_id, provider_id, model_id, input_tokens, output_tokens, estimated_cost)
    VALUES ($1,$2,$3,$4,$5,$6)
  `, [runId, provider, model || null, inputTokens, outputTokens, estimatedCost]);
}

export async function usageSummary() {
  if (!databaseEnabled) return null;
  const result = await query(`
    SELECT COALESCE(sum(input_tokens),0)::bigint AS input_tokens,
           COALESCE(sum(output_tokens),0)::bigint AS output_tokens,
           COALESCE(sum(estimated_cost),0)::numeric AS estimated_cost
    FROM usage_events
  `);
  return {
    inputTokens: Number(result.rows[0].input_tokens),
    outputTokens: Number(result.rows[0].output_tokens),
    estimatedCost: Number(result.rows[0].estimated_cost)
  };
}
