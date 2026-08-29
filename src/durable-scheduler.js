import { databaseEnabled, query, withTransaction } from './db.js';

export const SCHEDULED_WORKERS = Object.freeze({
  DISCOVER: 'discover',
  VALIDATE: 'validate',
  EXECUTE: 'execute'
});

export const DEFAULT_SCHEDULES = Object.freeze([
  {
    id: 'taskman-discover-hourly',
    workerName: SCHEDULED_WORKERS.DISCOVER,
    scheduleExpression: '0 * * * *', // hourly at :00
    minuteOffset: 0
  },
  {
    id: 'taskman-validate-hourly',
    workerName: SCHEDULED_WORKERS.VALIDATE,
    scheduleExpression: '10 * * * *', // hourly at :10
    minuteOffset: 10
  },
  {
    id: 'taskman-execute-hourly',
    workerName: SCHEDULED_WORKERS.EXECUTE,
    scheduleExpression: '20 * * * *', // hourly at :20
    minuteOffset: 20
  }
]);

export const DEFAULT_LEASE_MS = 10 * 60 * 1000; // 10 minutes lease duration

/**
 * Parses minute offset from cron expression like "M * * * *" or integer offset.
 */
export function getMinuteOffset(scheduleExpression) {
  if (typeof scheduleExpression === 'number') return scheduleExpression % 60;
  const parts = String(scheduleExpression || '').trim().split(/\s+/);
  const min = parseInt(parts[0], 10);
  return Number.isFinite(min) ? min % 60 : 0;
}

/**
 * Calculates the next future due time for an hourly staggered schedule starting after afterTime.
 */
export function computeNextRunAt(scheduleExpression, afterTime = new Date()) {
  const after = new Date(afterTime);
  const offset = getMinuteOffset(scheduleExpression);

  const candidate = new Date(after);
  candidate.setUTCMinutes(offset, 0, 0);

  if (candidate.getTime() <= after.getTime()) {
    candidate.setUTCHours(candidate.getUTCHours() + 1);
  }
  return candidate;
}

/**
 * Generates an idempotent run key for a job execution at a specific scheduled time.
 * Format: {jobId}:{YYYY-MM-DDTHH:MM:00.000Z}
 */
export function generateRunKey(jobId, scheduledFor) {
  const d = new Date(scheduledFor);
  d.setUTCSeconds(0, 0);
  return `${jobId}:${d.toISOString().slice(0, 16)}:00Z`;
}

// In-Memory store for memory mode fallback
const memoryJobs = new Map();
const memoryRuns = new Map();

function normalizeJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    workerName: row.worker_name || row.workerName,
    scheduleExpression: row.schedule_expression || row.scheduleExpression,
    nextRunAt: row.next_run_at ? new Date(row.next_run_at).toISOString() : (row.nextRunAt ? new Date(row.nextRunAt).toISOString() : null),
    lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : (row.lastRunAt ? new Date(row.lastRunAt).toISOString() : null),
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : (row.lastSuccessAt ? new Date(row.lastSuccessAt).toISOString() : null),
    lastErrorAt: row.last_error_at ? new Date(row.last_error_at).toISOString() : (row.lastErrorAt ? new Date(row.lastErrorAt).toISOString() : null),
    lastError: row.last_error || row.lastError || null,
    leaseOwner: row.lease_owner || row.leaseOwner || null,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : (row.leaseExpiresAt ? new Date(row.leaseExpiresAt).toISOString() : null),
    runKey: row.run_key || row.runKey || null,
    enabled: row.enabled !== false,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : (row.createdAt || new Date().toISOString()),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : (row.updatedAt || new Date().toISOString())
  };
}

export function isSchedulerDurable() {
  return databaseEnabled;
}

/**
 * Initializes default scheduled jobs in database or memory.
 */
export async function initializeScheduler({ now = new Date() } = {}) {
  const initialized = [];
  for (const def of DEFAULT_SCHEDULES) {
    const nextRun = computeNextRunAt(def.scheduleExpression, now);
    if (!databaseEnabled) {
      if (!memoryJobs.has(def.id)) {
        const job = normalizeJob({
          id: def.id,
          workerName: def.workerName,
          scheduleExpression: def.scheduleExpression,
          nextRunAt: nextRun.toISOString(),
          enabled: true
        });
        memoryJobs.set(def.id, job);
        initialized.push(job);
      } else {
        initialized.push(memoryJobs.get(def.id));
      }
      continue;
    }

    const res = await query(`
      INSERT INTO scheduled_jobs (id, worker_name, schedule_expression, next_run_at, enabled)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `, [def.id, def.workerName, def.scheduleExpression, nextRun.toISOString()]);

    if (res.rows.length > 0) {
      initialized.push(normalizeJob(res.rows[0]));
    } else {
      const existing = await query('SELECT * FROM scheduled_jobs WHERE id = $1', [def.id]);
      initialized.push(normalizeJob(existing.rows[0]));
    }
  }
  return initialized;
}

/**
 * Lists all configured scheduled jobs.
 */
export async function listScheduledJobs() {
  if (!databaseEnabled) {
    return Array.from(memoryJobs.values());
  }
  const res = await query('SELECT * FROM scheduled_jobs ORDER BY worker_name ASC');
  return res.rows.map(normalizeJob);
}

/**
 * Reconciles overdue schedules on startup with a bounded catch-up policy.
 * Executes at most one overdue run immediately (scheduledFor = now), then calculates next future run.
 */
export async function reconcileOverdueJobs({ now = new Date() } = {}) {
  const jobs = await listScheduledJobs();
  const reconciled = [];

  for (const job of jobs) {
    if (!job.enabled) continue;
    const nextRun = new Date(job.nextRunAt);
    if (nextRun.getTime() < now.getTime()) {
      // Overdue: apply bounded catch-up.
      // If overdue by more than 1 cycle, set nextRunAt to now so it fires once immediately.
      reconciled.push({
        id: job.id,
        workerName: job.workerName,
        overdueByMs: now.getTime() - nextRun.getTime(),
        catchUpApplied: true
      });
    }
  }
  return reconciled;
}

/**
 * Atomically claims a due scheduled job using PostgreSQL lease semantics (FOR UPDATE SKIP LOCKED)
 * or memory fallback locking.
 * 
 * Returns a claim ticket containing { job, runKey, scheduledFor } or null if no due job can be claimed.
 */
export async function claimScheduledJob(jobIdOrWorkerName, {
  now = new Date(),
  leaseMs = DEFAULT_LEASE_MS,
  claimedBy = `taskman-scheduler-${process.pid}`
} = {}) {
  const currentTime = new Date(now);
  const leaseExpiresAt = new Date(currentTime.getTime() + leaseMs);

  if (!databaseEnabled) {
    // In-memory fallback claim logic
    for (const job of memoryJobs.values()) {
      if (jobIdOrWorkerName && job.id !== jobIdOrWorkerName && job.workerName !== jobIdOrWorkerName) {
        continue;
      }
      if (!job.enabled) continue;

      const isDue = new Date(job.nextRunAt).getTime() <= currentTime.getTime();
      const leaseActive = job.leaseOwner && job.leaseExpiresAt && new Date(job.leaseExpiresAt).getTime() > currentTime.getTime();

      // A job can only be claimed if it is currently due (nextRunAt <= currentTime),
      // or if it was claimed previously and its lease has expired without finishing.
      if (!isDue && !leaseActive) {
        continue;
      }
      if (leaseActive) {
        // Active lease held by another worker
        continue;
      }

      const scheduledFor = new Date(job.nextRunAt);
      const runKey = generateRunKey(job.id, scheduledFor);

      // Check duplicate run key
      if (memoryRuns.has(runKey)) {
        const run = memoryRuns.get(runKey);
        if (run.status === 'COMPLETED') {
          // Already completed, advance schedule to next future run
          job.nextRunAt = computeNextRunAt(job.scheduleExpression, currentTime).toISOString();
          job.leaseOwner = null;
          job.leaseExpiresAt = null;
          continue;
        }
        if (run.status === 'RUNNING' && new Date(job.leaseExpiresAt).getTime() > currentTime.getTime()) {
          // Another worker is running with active lease
          continue;
        }
      }

      // Claim in memory
      job.leaseOwner = claimedBy;
      job.leaseExpiresAt = leaseExpiresAt.toISOString();
      job.lastRunAt = currentTime.toISOString();
      job.runKey = runKey;

      memoryRuns.set(runKey, {
        id: crypto.randomUUID(),
        jobId: job.id,
        workerName: job.workerName,
        runKey,
        scheduledFor: scheduledFor.toISOString(),
        startedAt: currentTime.toISOString(),
        status: 'RUNNING',
        claimedBy
      });

      return {
        job: normalizeJob(job),
        runKey,
        scheduledFor: scheduledFor.toISOString(),
        claimedBy,
        durable: false
      };
    }
    return null;
  }

  // PostgreSQL Atomic Claim with Transaction and Row-Level Lock
  return withTransaction(async client => {
    // Select the job if it is due (and not actively leased), or if its lease has expired
    const queryStr = `
      SELECT * FROM scheduled_jobs
      WHERE (id = $1 OR worker_name = $1)
        AND enabled = true
        AND (
          (next_run_at <= $2 AND (lease_owner IS NULL OR lease_expires_at <= $2))
          OR (lease_owner IS NOT NULL AND lease_expires_at <= $2)
        )
      ORDER BY next_run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const res = await client.query(queryStr, [jobIdOrWorkerName, currentTime.toISOString()]);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    const isDue = new Date(row.next_run_at).getTime() <= currentTime.getTime();
    const scheduledFor = isDue ? new Date(row.next_run_at) : currentTime;
    const runKey = generateRunKey(row.id, scheduledFor);

    // Check if run_key was already executed and completed
    const existingRunRes = await client.query(
      'SELECT * FROM scheduled_job_runs WHERE run_key = $1',
      [runKey]
    );

    if (existingRunRes.rows.length > 0) {
      const existingRun = existingRunRes.rows[0];
      if (existingRun.status === 'COMPLETED') {
        // Idempotency: advance next_run_at to avoid re-running completed firing
        const nextFutureRun = computeNextRunAt(row.schedule_expression, currentTime);
        await client.query(`
          UPDATE scheduled_jobs
          SET next_run_at = $1, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
          WHERE id = $2
        `, [nextFutureRun.toISOString(), row.id]);
        return null;
      }
    }

    // Insert or update scheduled_job_runs entry
    await client.query(`
      INSERT INTO scheduled_job_runs (job_id, worker_name, run_key, scheduled_for, started_at, status, claimed_by)
      VALUES ($1, $2, $3, $4, $5, 'RUNNING', $6)
      ON CONFLICT (run_key) DO UPDATE
      SET status = 'RUNNING', claimed_by = EXCLUDED.claimed_by, started_at = EXCLUDED.started_at, updated_at = now()
    `, [row.id, row.worker_name, runKey, scheduledFor.toISOString(), currentTime.toISOString(), claimedBy]);

    // Update lease on scheduled_jobs
    const updateRes = await client.query(`
      UPDATE scheduled_jobs
      SET lease_owner = $1,
          lease_expires_at = $2,
          last_run_at = $3,
          run_key = $4,
          updated_at = now()
      WHERE id = $5
      RETURNING *
    `, [claimedBy, leaseExpiresAt.toISOString(), currentTime.toISOString(), runKey, row.id]);

    return {
      job: normalizeJob(updateRes.rows[0]),
      runKey,
      scheduledFor: scheduledFor.toISOString(),
      claimedBy,
      durable: true
    };
  });
}

/**
 * Records completion of a scheduled job run, clears the lease, and calculates next_run_at.
 */
export async function finishScheduledJobRun({
  jobId,
  runKey,
  status = 'COMPLETED',
  result = null,
  error = null,
  now = new Date()
} = {}) {
  const finishTime = new Date(now);

  if (!databaseEnabled) {
    const job = memoryJobs.get(jobId);
    if (job) {
      const nextRun = computeNextRunAt(job.scheduleExpression, finishTime);
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.lastRunAt = finishTime.toISOString();
      job.nextRunAt = nextRun.toISOString();
      if (status === 'COMPLETED') {
        job.lastSuccessAt = finishTime.toISOString();
        job.lastError = null;
      } else {
        job.lastErrorAt = finishTime.toISOString();
        job.lastError = String(error || 'Failed');
      }
      job.updatedAt = finishTime.toISOString();
    }
    if (runKey && memoryRuns.has(runKey)) {
      const run = memoryRuns.get(runKey);
      run.finishedAt = finishTime.toISOString();
      run.status = status;
      run.result = result;
      run.error = error ? String(error) : null;
    }
    return { ok: true, jobId, runKey, nextRunAt: job?.nextRunAt };
  }

  return withTransaction(async client => {
    // 1. Update scheduled_job_runs
    if (runKey) {
      await client.query(`
        UPDATE scheduled_job_runs
        SET status = $1,
            finished_at = $2,
            result = $3::jsonb,
            error = $4,
            updated_at = now()
        WHERE run_key = $5
      `, [status, finishTime.toISOString(), JSON.stringify(result || {}), error ? String(error) : null, runKey]);
    }

    // 2. Fetch job to get scheduleExpression
    const jobRes = await client.query('SELECT * FROM scheduled_jobs WHERE id = $1', [jobId]);
    if (jobRes.rows.length === 0) return { ok: false, error: 'job not found' };

    const job = jobRes.rows[0];
    const nextRun = computeNextRunAt(job.schedule_expression, finishTime);

    // 3. Update scheduled_jobs clearing lease and advancing next_run_at
    const isSuccess = status === 'COMPLETED';
    const updateRes = await client.query(`
      UPDATE scheduled_jobs
      SET lease_owner = NULL,
          lease_expires_at = NULL,
          next_run_at = $1,
          last_success_at = CASE WHEN $2 THEN $3 ELSE last_success_at END,
          last_error_at = CASE WHEN NOT $2 THEN $3 ELSE last_error_at END,
          last_error = CASE WHEN NOT $2 THEN $4 ELSE last_error END,
          updated_at = now()
      WHERE id = $5
      RETURNING *
    `, [
      nextRun.toISOString(),
      isSuccess,
      finishTime.toISOString(),
      error ? String(error) : null,
      jobId
    ]);

    return {
      ok: true,
      job: normalizeJob(updateRes.rows[0]),
      nextRunAt: nextRun.toISOString()
    };
  });
}

/**
 * Resets an in-memory job or database job for testing.
 */
export async function resetScheduledJobsForTesting() {
  memoryJobs.clear();
  memoryRuns.clear();
  if (databaseEnabled) {
    await query('DELETE FROM scheduled_job_runs');
    await query('DELETE FROM scheduled_jobs');
  }
}
