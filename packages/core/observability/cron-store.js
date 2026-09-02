import { databaseEnabled, query } from '@taskman/db';
import { MemoryTable, nowIso } from '../memory-table.js';

const mem = {
  runs: new MemoryTable({ unique: ['cronName', 'runKey'] }),
  expectations: new MemoryTable({ unique: ['cronName'] })
};

const normalizeRun = (row = {}) => ({
  id: row.id,
  cronName: row.cronName ?? row.cron_name,
  runKey: row.runKey ?? row.run_key,
  status: row.status,
  host: row.host ?? null,
  durationMs: row.durationMs ?? row.duration_ms ?? null,
  result: row.result || {},
  error: row.error ?? null,
  startedAt: row.startedAt ?? row.started_at ?? null,
  finishedAt: row.finishedAt ?? row.finished_at ?? null
});

/** A cron must declare itself before the watchdog can miss it. */
export async function registerCron({ cronName, schedule, maxSilenceSeconds, description = null, enabled = true }) {
  if (!cronName || !schedule || !maxSilenceSeconds) {
    throw new Error('cronName, schedule and maxSilenceSeconds are required');
  }
  const row = { cronName, schedule, maxSilenceSeconds: Number(maxSilenceSeconds), description, enabled };

  if (!databaseEnabled) {
    mem.expectations.upsert(row, row);
    return row;
  }
  const result = await query(`
    INSERT INTO cron_expectations(cron_name, schedule, max_silence_seconds, description, enabled)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT (cron_name) DO UPDATE SET
      schedule=EXCLUDED.schedule, max_silence_seconds=EXCLUDED.max_silence_seconds,
      description=EXCLUDED.description, enabled=EXCLUDED.enabled, updated_at=now()
    RETURNING *
  `, [cronName, schedule, row.maxSilenceSeconds, description, enabled]);
  return result.rows[0];
}

/**
 * Opens a run. Returns `{ duplicate: true }` when this slot already ran, which is
 * how the same schedule firing from two runners collapses to one execution.
 */
export async function startCronRun({ cronName, runKey, host = process.env.HOSTNAME || 'local' }) {
  const row = normalizeRun({
    id: crypto.randomUUID(), cronName, runKey, status: 'RUNNING', host, startedAt: nowIso()
  });

  if (!databaseEnabled) {
    const inserted = mem.runs.insert(row);
    return { run: inserted.row, duplicate: !inserted.inserted };
  }

  const result = await query(`
    INSERT INTO cron_runs(id, cron_name, run_key, status, host)
    VALUES($1,$2,$3,'RUNNING',$4)
    ON CONFLICT (cron_name, run_key) DO NOTHING
    RETURNING *
  `, [row.id, cronName, runKey, host]);

  if (!result.rowCount) {
    const existing = await query('SELECT * FROM cron_runs WHERE cron_name=$1 AND run_key=$2', [cronName, runKey]);
    return { run: normalizeRun(existing.rows[0]), duplicate: true };
  }
  return { run: normalizeRun(result.rows[0]), duplicate: false };
}

export async function finishCronRun(id, { status, result = {}, error = null, durationMs = null }) {
  if (!databaseEnabled) {
    const run = mem.runs.find(r => r.id === id);
    if (!run) return null;
    Object.assign(run, { status, result, error, durationMs, finishedAt: nowIso() });
    return run;
  }
  const updated = await query(`
    UPDATE cron_runs SET status=$2, result=$3::jsonb, error=$4, duration_ms=$5, finished_at=now()
    WHERE id=$1 RETURNING *
  `, [id, status, JSON.stringify(result), error, durationMs]);
  return updated.rows[0] ? normalizeRun(updated.rows[0]) : null;
}

export async function listCronRuns({ cronName = null, limit = 50 } = {}) {
  if (!databaseEnabled) {
    return mem.runs.filter(r => !cronName || r.cronName === cronName).slice(-limit).reverse();
  }
  const params = [];
  let where = '';
  if (cronName) { params.push(cronName); where = 'WHERE cron_name = $1'; }
  params.push(limit);
  const result = await query(`SELECT * FROM cron_runs ${where} ORDER BY started_at DESC LIMIT $${params.length}`, params);
  return result.rows.map(normalizeRun);
}

/**
 * The watchdog's view: every registered cron with how long it has been silent.
 *
 * Silence is the signal that matters. A failing cron reports an error; a cron that
 * stopped being scheduled reports nothing at all, and that is the failure this
 * whole table exists to catch.
 */
export async function cronStatuses({ now = new Date() } = {}) {
  let expectations;
  let lastRuns = new Map();

  if (!databaseEnabled) {
    expectations = mem.expectations.all();
    for (const run of mem.runs.all()) {
      const current = lastRuns.get(run.cronName);
      if (!current || new Date(run.startedAt) > new Date(current.startedAt)) lastRuns.set(run.cronName, run);
    }
  } else {
    const rows = await query('SELECT * FROM cron_expectations ORDER BY cron_name');
    expectations = rows.rows.map(r => ({
      cronName: r.cron_name, schedule: r.schedule,
      maxSilenceSeconds: Number(r.max_silence_seconds), description: r.description, enabled: r.enabled
    }));
    const latest = await query(`
      SELECT DISTINCT ON (cron_name) * FROM cron_runs ORDER BY cron_name, started_at DESC
    `);
    lastRuns = new Map(latest.rows.map(r => [r.cron_name, normalizeRun(r)]));
  }

  return expectations.map(expectation => {
    const last = lastRuns.get(expectation.cronName) || null;
    const silentSeconds = last ? Math.round((now - new Date(last.startedAt)) / 1000) : null;
    const overdue = expectation.enabled && (last === null || silentSeconds > expectation.maxSilenceSeconds);

    let status = 'OK';
    if (!expectation.enabled) status = 'DISABLED';
    else if (overdue) status = 'OVERDUE';
    else if (last?.status === 'FAILED') status = 'FAILING';
    else if (last?.status === 'RUNNING' && silentSeconds > expectation.maxSilenceSeconds) status = 'STUCK';

    return {
      cronName: expectation.cronName,
      schedule: expectation.schedule,
      maxSilenceSeconds: expectation.maxSilenceSeconds,
      status,
      lastRunAt: last?.startedAt ?? null,
      lastStatus: last?.status ?? null,
      lastError: last?.error ?? null,
      silentSeconds
    };
  });
}

export function resetCronMemory() { mem.runs.clear(); mem.expectations.clear(); }
