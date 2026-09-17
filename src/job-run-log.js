import { randomUUID } from 'node:crypto';
import { databaseEnabled, query } from './db.js';
import { scrubSecrets } from './adapters/coding-agent-adapter.js';

/**
 * The attempt count, at stage granularity.
 *
 * This is the store the runner's fourth gate writes to. It exists so that the
 * question "did we ever actually try?" has an answer that is not a memory, and
 * so the kill criteria that already exist in this repository finally have data
 * to read.
 */

const mem = { runs: [] };

const normalize = (row) => row && ({
  id: row.id,
  job: row.job,
  rail: row.rail ?? null,
  stage: row.stage,
  outcome: row.outcome,
  reason: row.reason ?? null,
  approval: row.approval ?? null,
  ranAt: row.ran_at ?? row.ranAt
});

/** Write one stage run. Shaped to be passed straight to the runner as `log`. */
export async function recordJobRun({ job, rail = null, stage, outcome, reason = null, approval = null, at = null } = {}) {
  const row = {
    id: randomUUID(),
    job,
    rail,
    stage,
    outcome,
    // A reason is free text carrying an error message, which can hold anything.
    reason: reason == null ? null : scrubSecrets(String(reason)),
    approval,
    ranAt: at || new Date().toISOString()
  };

  if (!databaseEnabled) {
    mem.runs.push(row);
    return normalize(row);
  }

  const { rows } = await query(
    `INSERT INTO job_runs (id, job, rail, stage, outcome, reason, approval, ran_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [row.id, row.job, row.rail, row.stage, row.outcome, row.reason, row.approval, row.ranAt]);
  return normalize(rows[0]);
}

export async function listJobRuns({ job = null, limit = 200 } = {}) {
  if (!databaseEnabled) {
    return mem.runs.filter(r => !job || r.job === job).slice(-limit).reverse().map(normalize);
  }
  const params = [];
  let where = '';
  if (job) { params.push(job); where = 'WHERE job = $1'; }
  params.push(Math.min(Number(limit) || 200, 1000));
  const { rows } = await query(
    `SELECT * FROM job_runs ${where} ORDER BY ran_at DESC LIMIT $${params.length}`, params);
  return rows.map(normalize);
}

/** Attempts per outcome for one job — what a kill criterion reads. */
export async function jobRunSummary(job) {
  const runs = await listJobRuns({ job, limit: 1000 });
  const byOutcome = { OK: 0, REFUSED: 0, FAILED: 0 };
  for (const r of runs) byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
  return { job, attempts: runs.length, byOutcome, charged: runs.filter(r => r.stage === 'charge' && r.outcome === 'OK').length };
}

export function resetJobRunLogForTesting() {
  mem.runs.length = 0;
}
