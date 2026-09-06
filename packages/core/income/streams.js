import { databaseEnabled, query, truncateForTesting } from '@taskman/db';
import { MemoryTable } from '../memory-table.js';

const mem = { streams: new MemoryTable({ unique: ['streamKey'] }) };

export const STREAM_STATES = Object.freeze({
  HYPOTHESIS: 'HYPOTHESIS',
  TESTING: 'TESTING',
  BLOCKED: 'BLOCKED',
  EARNING: 'EARNING',
  DISPROVEN: 'DISPROVEN'
});

const UNBLOCKED_BY = Object.freeze(['machine', 'human']);

/**
 * Where a stream came from. Checked here so an unknown value is a clear error
 * rather than a 500 out of a database constraint.
 *
 * The console's POST route defaulted to an origin the schema did not allow, and
 * the failure surfaced as "violates check constraint income_streams_origin_check"
 * with a 500 — a message that tells the person who typed the form nothing, and
 * which memory mode hid entirely because it enforces no constraints.
 *
 *   seed         declared in code (packages/core/income/defaults.js)
 *   discovered   proposed by a detector from recorded evidence
 *   operator_ui  a person, through the API
 *   local_entry  a person, through the operator console
 */
export const STREAM_ORIGINS = Object.freeze(['seed', 'discovered', 'operator_ui', 'local_entry']);

const toIso = value => (value == null ? null : new Date(value).toISOString());

const normalize = (row = {}) => ({
  streamKey: row.streamKey ?? row.stream_key,
  title: row.title,
  mechanism: row.mechanism,
  requires: row.requires,
  nextAction: row.nextAction ?? row.next_action,
  unblockedBy: row.unblockedBy ?? row.unblocked_by,
  state: row.state,
  origin: row.origin || 'seed',
  fingerprint: row.fingerprint ?? null,
  detector: row.detector ?? null,
  stateReason: row.stateReason ?? row.state_reason ?? null,
  testCostHours: row.testCostHours ?? (row.test_cost_hours == null ? null : Number(row.test_cost_hours)),
  proofCents: row.proofCents ?? row.proof_cents ?? null,
  // node-postgres returns a timestamptz as a Date while the memory store holds an
  // ISO string, so callers got different types depending on the backend. Both
  // normalise to ISO here; a field whose type depends on storage is a bug waiting
  // for whoever calls .slice() on it.
  firstSettledAt: toIso(row.firstSettledAt ?? row.first_settled_at),
  evidence: row.evidence || []
});

/**
 * Records one way this system could earn.
 *
 * `mechanism` must say how money physically arrives and `requires` must state
 * what would have to be true — together they are what makes a stream
 * disprovable instead of a wish. `unblockedBy` separates the streams this
 * machine can advance on its own from the ones waiting on a person; conflating
 * those is why a blocked lane can sit for weeks looking like active work.
 */
export async function registerStream({
  streamKey, title, mechanism, requires, nextAction, unblockedBy,
  state = STREAM_STATES.HYPOTHESIS, stateReason = null,
  testCostHours = null, proofCents = null, evidence = [],
  origin = 'seed', fingerprint = null, detector = null, discoveredAt = null
}) {
  if (!streamKey || !title) throw new Error('streamKey and title are required');
  if (!mechanism) throw new Error(`${streamKey}: mechanism is required — name how the money physically arrives`);
  if (!requires) throw new Error(`${streamKey}: requires is required — a stream that cannot be disproven cannot be tested`);
  if (!nextAction) throw new Error(`${streamKey}: nextAction is required`);
  if (!UNBLOCKED_BY.includes(unblockedBy)) {
    throw new Error(`${streamKey}: unblockedBy must be one of ${UNBLOCKED_BY.join(', ')} — say who can move this`);
  }
  if (!STREAM_STATES[state]) throw new Error(`${streamKey}: unknown state ${state}`);
  if (!STREAM_ORIGINS.includes(origin)) {
    throw new Error(`${streamKey}: unknown origin "${origin}" — must be one of ${STREAM_ORIGINS.join(', ')}`);
  }

  const row = {
    streamKey, title, mechanism, requires, nextAction, unblockedBy,
    state, stateReason, testCostHours, proofCents, evidence, firstSettledAt: null,
    origin, fingerprint, detector, discoveredAt
  };

  if (!databaseEnabled) {
    // Never clobber a state the system has already moved on.
    const existing = mem.streams.find(s => s.streamKey === streamKey);
    if (existing) return normalize(existing);
    mem.streams.upsert(row, row);
    return normalize(row);
  }

  const result = await query(`
    INSERT INTO income_streams(stream_key, title, mechanism, requires, next_action, unblocked_by,
      state, state_reason, test_cost_hours, proof_cents, evidence, origin, fingerprint, detector, discovered_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)
    ON CONFLICT (stream_key) DO UPDATE SET
      title = EXCLUDED.title, mechanism = EXCLUDED.mechanism, requires = EXCLUDED.requires,
      updated_at = now()
    RETURNING *
  `, [streamKey, title, mechanism, requires, nextAction, unblockedBy,
      state, stateReason, testCostHours, proofCents, JSON.stringify(evidence),
      origin, fingerprint, detector, discoveredAt ? new Date(discoveredAt).toISOString() : null]);
  return normalize(result.rows[0]);
}

/**
 * Moves a stream, with the evidence that justifies the move.
 *
 * EARNING is deliberately not settable here. A stream becomes EARNING only via
 * markStreamSettled(), from a real settlement — the same rule the money ledger
 * enforces, for the same reason: this system has been wrong before by believing
 * its own optimistic status.
 */
export async function setStreamState(streamKey, state, { reason = null, evidence = null } = {}) {
  if (!STREAM_STATES[state]) throw new Error(`unknown state ${state}`);
  if (state === STREAM_STATES.EARNING) {
    throw new Error('EARNING is set only by markStreamSettled(), from a verified settlement — never by hand');
  }
  if (!databaseEnabled) {
    const existing = mem.streams.find(s => s.streamKey === streamKey);
    if (!existing) return null;
    existing.state = state;
    existing.stateReason = reason;
    if (evidence) existing.evidence = [...(existing.evidence || []), ...evidence];
    return normalize(existing);
  }
  const result = await query(`
    UPDATE income_streams SET state=$2, state_reason=$3,
      evidence = CASE WHEN $4::jsonb IS NULL THEN evidence ELSE evidence || $4::jsonb END,
      updated_at=now()
    WHERE stream_key=$1 RETURNING *
  `, [streamKey, state, reason, evidence ? JSON.stringify(evidence) : null]);
  return result.rows[0] ? normalize(result.rows[0]) : null;
}

/** The only path to EARNING: a settlement that actually cleared. */
export async function markStreamSettled(streamKey, { settledAt = new Date(), externalRef }) {
  if (!externalRef) {
    throw new Error('externalRef is required — an unverifiable settlement does not move a stream to EARNING');
  }
  const evidence = [{ kind: 'settlement', externalRef, at: new Date(settledAt).toISOString() }];
  if (!databaseEnabled) {
    const existing = mem.streams.find(s => s.streamKey === streamKey);
    if (!existing) return null;
    existing.state = STREAM_STATES.EARNING;
    existing.stateReason = `settled: ${externalRef}`;
    existing.firstSettledAt = existing.firstSettledAt || new Date(settledAt).toISOString();
    existing.evidence = [...(existing.evidence || []), ...evidence];
    return normalize(existing);
  }
  const result = await query(`
    UPDATE income_streams SET state='EARNING', state_reason=$3,
      first_settled_at = COALESCE(first_settled_at, $2),
      evidence = evidence || $4::jsonb, updated_at=now()
    WHERE stream_key=$1 RETURNING *
  `, [streamKey, new Date(settledAt).toISOString(), `settled: ${externalRef}`, JSON.stringify(evidence)]);
  return result.rows[0] ? normalize(result.rows[0]) : null;
}

export async function listStreams({ state = null } = {}) {
  if (!databaseEnabled) {
    return mem.streams.all().filter(s => !state || s.state === state).map(normalize);
  }
  const result = state
    ? await query('SELECT * FROM income_streams WHERE state=$1 ORDER BY stream_key', [state])
    : await query('SELECT * FROM income_streams ORDER BY stream_key');
  return result.rows.map(normalize);
}

/**
 * What to work on next, and what is not worth working on.
 *
 * Ordering is by cheapest credible test first among the streams this machine can
 * actually advance. A blocked-on-human stream is never "next" — surfacing it as
 * actionable is how a queue fills with work nobody can do. They are reported
 * separately so the one person who can unblock them sees a short, honest list.
 */
export async function streamPortfolio() {
  const streams = await listStreams({});
  const byState = s => streams.filter(x => x.state === s);
  const actionable = streams
    .filter(s => s.unblockedBy === 'machine' && [STREAM_STATES.HYPOTHESIS, STREAM_STATES.TESTING].includes(s.state))
    .sort((a, b) => (a.testCostHours ?? Infinity) - (b.testCostHours ?? Infinity));
  const waitingOnHuman = streams
    .filter(s => s.unblockedBy === 'human' && ![STREAM_STATES.DISPROVEN, STREAM_STATES.EARNING].includes(s.state));

  return {
    total: streams.length,
    earning: byState(STREAM_STATES.EARNING).length,
    disproven: byState(STREAM_STATES.DISPROVEN).length,
    actionable,
    waitingOnHuman,
    // The number that matters. Everything else is preparation.
    anySettled: byState(STREAM_STATES.EARNING).length > 0,
    nextAction: actionable[0]?.nextAction
      ?? (waitingOnHuman[0] ? `blocked on a person: ${waitingOnHuman[0].nextAction}` : null)
  };
}

export async function resetIncomeMemory() {
  mem.streams.clear();
  await truncateForTesting(['income_streams']);
}
