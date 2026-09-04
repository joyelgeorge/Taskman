import { databaseEnabled, query } from './db.js';

/**
 * Settlement-verified money ledger.
 *
 * Taskman already scores, qualifies and routes. What it could not do is state how
 * much money it has actually made, because nothing ever wrote a verified number
 * anywhere. Estimates live in candidate payloads; this module is the only place
 * realized money is allowed to exist, and it refuses any figure that no external
 * system can confirm.
 */

const memory = { rails: new Map(), attempts: [], settlements: [] };

export const ATTEMPT_STATUS = Object.freeze({
  STARTED: 'STARTED',
  BLOCKED: 'BLOCKED',
  SETUP_REQUIRED: 'SETUP_REQUIRED',
  DELIVERED: 'DELIVERED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED'
});

export const SETTLEMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  CLEARED: 'CLEARED',
  REVERSED: 'REVERSED'
});

/** Sources that can be re-queried to confirm the money exists. */
export const VERIFIED_SOURCES = Object.freeze(['stripe', 'bank', 'manual_receipt']);

/**
 * The four states a rail moves through. See src/rail-governor.js for the
 * transition table; this module only stores the state and the raw ledger data
 * the governor reads.
 */
export const RAIL_STATES = Object.freeze(['PROBATION', 'PROVEN', 'SCALED', 'DISABLED']);

const cents = value => {
  const n = Math.round(Number(value ?? 0));
  return Number.isFinite(n) ? n : 0;
};

const usd = c => `$${(Number(c || 0) / 100).toFixed(2)}`;

function normalizeAttempt(row = {}) {
  return {
    id: row.id,
    rail: row.rail,
    candidateKey: row.candidateKey ?? row.candidate_key ?? null,
    stage: row.stage || 'EXECUTE',
    status: row.status || ATTEMPT_STATUS.STARTED,
    costCents: cents(row.costCents ?? row.cost_cents),
    evidence: row.evidence || {},
    startedAt: row.startedAt || row.started_at || null,
    finishedAt: row.finishedAt || row.finished_at || null,
    probationEpoch: Number(row.probationEpoch ?? row.probation_epoch ?? 0)
  };
}

function normalizeSettlement(row = {}) {
  const gross = cents(row.grossCents ?? row.gross_cents);
  const fee = cents(row.feeCents ?? row.fee_cents);
  return {
    id: row.id,
    rail: row.rail,
    attemptId: row.attemptId ?? row.attempt_id ?? null,
    source: row.source,
    externalRef: row.externalRef ?? row.external_ref,
    grossCents: gross,
    feeCents: fee,
    netCents: cents(row.netCents ?? row.net_cents ?? gross - fee),
    currency: (row.currency || 'USD').toUpperCase(),
    status: row.status || SETTLEMENT_STATUS.PENDING,
    verifiedAt: row.verifiedAt || row.verified_at || null,
    verification: row.verification || {},
    createdAt: row.createdAt || row.created_at || null,
    probationEpoch: Number(row.probationEpoch ?? row.probation_epoch ?? 0)
  };
}

/** The probation epoch currently active for a rail; 0 for a rail with no state row. */
async function currentEpoch(rail) {
  const state = await getRailState(rail);
  return Number(state?.probation_epoch ?? 0);
}

export async function recordAttempt({ rail, candidateKey = null, stage = 'EXECUTE', costCents = 0, evidence = {} }) {
  if (!rail) throw new Error('rail is required');
  const epoch = await currentEpoch(rail);
  const attempt = normalizeAttempt({
    id: crypto.randomUUID(),
    rail,
    candidate_key: candidateKey,
    stage,
    status: ATTEMPT_STATUS.STARTED,
    cost_cents: costCents,
    evidence,
    started_at: new Date().toISOString(),
    probation_epoch: epoch
  });

  if (!databaseEnabled) {
    memory.attempts.push(attempt);
    return attempt;
  }

  const result = await query(
    `INSERT INTO rail_attempts(id, rail, candidate_key, stage, status, cost_cents, evidence, probation_epoch)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *`,
    [attempt.id, rail, candidateKey, stage, attempt.status, attempt.costCents, JSON.stringify(evidence), epoch]
  );
  return normalizeAttempt(result.rows[0]);
}

export async function finishAttempt(id, { status, costCents, evidence } = {}) {
  if (!id) throw new Error('attempt id is required');

  if (!databaseEnabled) {
    const attempt = memory.attempts.find(a => a.id === id);
    if (!attempt) return null;
    if (status) attempt.status = status;
    if (costCents !== undefined) attempt.costCents = cents(costCents);
    if (evidence) attempt.evidence = { ...attempt.evidence, ...evidence };
    attempt.finishedAt = new Date().toISOString();
    return attempt;
  }

  const result = await query(
    `UPDATE rail_attempts SET
       status = COALESCE($2, status),
       cost_cents = COALESCE($3, cost_cents),
       evidence = CASE WHEN $4::jsonb IS NULL THEN evidence ELSE evidence || $4::jsonb END,
       finished_at = now()
     WHERE id = $1 RETURNING *`,
    [id, status || null, costCents === undefined ? null : cents(costCents), evidence ? JSON.stringify(evidence) : null]
  );
  return result.rows[0] ? normalizeAttempt(result.rows[0]) : null;
}

/**
 * The only way realized money enters the system.
 *
 * Requires a source that can be re-queried and a reference that identifies the
 * transaction inside it. An agent that "believes" it earned something cannot
 * express that belief through this function, which is the point.
 */
export async function recordSettlement({
  rail,
  attemptId = null,
  source,
  externalRef,
  grossCents,
  feeCents = 0,
  currency = 'USD',
  status = SETTLEMENT_STATUS.PENDING,
  verification = {}
}) {
  if (!rail) throw new Error('rail is required');
  if (!VERIFIED_SOURCES.includes(source)) {
    throw new Error(`settlement source must be one of ${VERIFIED_SOURCES.join(', ')} — self-reported revenue is not accepted`);
  }
  if (!externalRef || !String(externalRef).trim()) {
    throw new Error('externalRef is required: a settlement no external system can confirm is not money');
  }
  const gross = cents(grossCents);
  if (gross <= 0) throw new Error('grossCents must be a positive amount');

  const epoch = await currentEpoch(rail);
  const settlement = normalizeSettlement({
    id: crypto.randomUUID(),
    rail,
    attempt_id: attemptId,
    source,
    external_ref: String(externalRef).trim(),
    gross_cents: gross,
    fee_cents: cents(feeCents),
    currency,
    status,
    verified_at: status === SETTLEMENT_STATUS.CLEARED ? new Date().toISOString() : null,
    verification,
    created_at: new Date().toISOString(),
    probation_epoch: epoch
  });

  if (!databaseEnabled) {
    const duplicate = memory.settlements.find(s => s.source === settlement.source && s.externalRef === settlement.externalRef);
    if (duplicate) return duplicate;
    memory.settlements.push(settlement);
    return settlement;
  }

  const result = await query(
    `INSERT INTO settlements(id, rail, attempt_id, source, external_ref, gross_cents, fee_cents, currency, status, verified_at, verification, probation_epoch)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
     ON CONFLICT (source, external_ref) DO UPDATE SET
       status = EXCLUDED.status,
       verified_at = EXCLUDED.verified_at,
       verification = EXCLUDED.verification
     RETURNING *`,
    [settlement.id, rail, attemptId, settlement.source, settlement.externalRef, settlement.grossCents,
     settlement.feeCents, settlement.currency, settlement.status, settlement.verifiedAt, JSON.stringify(verification), epoch]
  );
  return normalizeSettlement(result.rows[0]);
}

export async function markSettlementCleared(source, externalRef, verification = {}) {
  const now = new Date().toISOString();
  if (!databaseEnabled) {
    const settlement = memory.settlements.find(s => s.source === source && s.externalRef === externalRef);
    if (!settlement) return null;
    settlement.status = SETTLEMENT_STATUS.CLEARED;
    settlement.verifiedAt = now;
    settlement.verification = { ...settlement.verification, ...verification };
    return settlement;
  }
  const result = await query(
    `UPDATE settlements SET status=$3, verified_at=now(), verification = verification || $4::jsonb
     WHERE source=$1 AND external_ref=$2 RETURNING *`,
    [source, externalRef, SETTLEMENT_STATUS.CLEARED, JSON.stringify(verification)]
  );
  return result.rows[0] ? normalizeSettlement(result.rows[0]) : null;
}

/**
 * Individual attempt rows, not the aggregate railEconomics() returns.
 *
 * Needed because an attempt's `evidence` carries per-order detail the sums
 * throw away — how long a job actually took, most importantly. A rail can look
 * profitable per settlement and still be a bad business at three hours a job,
 * and only the individual rows can say so.
 */
export async function listAttempts({ rail = null, limit = 200 } = {}) {
  if (!databaseEnabled) {
    return memory.attempts
      .filter(a => !rail || a.rail === rail)
      .slice(-limit).reverse().map(normalizeAttempt);
  }
  const params = [];
  let where = '';
  if (rail) { params.push(rail); where = 'WHERE rail = $1'; }
  params.push(Math.min(Number(limit) || 200, 1000));
  const result = await query(
    `SELECT * FROM rail_attempts ${where} ORDER BY started_at DESC LIMIT $${params.length}`, params
  );
  return result.rows.map(normalizeAttempt);
}

export async function listSettlements({ rail = null, limit = 200 } = {}) {
  if (!databaseEnabled) {
    return memory.settlements
      .filter(s => !rail || s.rail === rail)
      .slice(-limit).reverse().map(normalizeSettlement);
  }
  const params = [];
  let where = '';
  if (rail) { params.push(rail); where = 'WHERE rail = $1'; }
  params.push(Math.min(Number(limit) || 200, 1000));
  const result = await query(
    `SELECT * FROM settlements ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
  );
  return result.rows.map(normalizeSettlement);
}

export async function railEconomics(rail = null) {
  if (!databaseEnabled) {
    const names = new Set([
      ...memory.attempts.map(a => a.rail),
      ...memory.settlements.map(s => s.rail),
      ...memory.rails.keys()
    ]);
    const rows = [...names]
      .filter(name => !rail || name === rail)
      .map(name => {
        const attempts = memory.attempts.filter(a => a.rail === name);
        const settlements = memory.settlements.filter(s => s.rail === name);
        const cleared = settlements.filter(s => s.status === SETTLEMENT_STATUS.CLEARED);
        const spendCents = attempts.reduce((sum, a) => sum + a.costCents, 0);
        const clearedCents = cleared.reduce((sum, s) => sum + s.netCents, 0);
        const railState = memory.rails.get(name);
        return {
          rail: name,
          attempts: attempts.length,
          spendCents,
          clearedCount: cleared.length,
          clearedCents,
          pendingCents: settlements
            .filter(s => s.status === SETTLEMENT_STATUS.PENDING)
            .reduce((sum, s) => sum + s.netCents, 0),
          netCents: clearedCents - spendCents,
          state: railState?.state || 'PROBATION',
          disabledReason: railState?.disabled_reason ?? null
        };
      });
    return rows.map(withDerived);
  }

  const result = rail
    ? await query('SELECT * FROM rail_economics WHERE rail = $1', [rail])
    : await query('SELECT * FROM rail_economics ORDER BY net_cents DESC');

  return result.rows.map(row => withDerived({
    rail: row.rail,
    attempts: Number(row.attempts),
    spendCents: Number(row.spend_cents),
    clearedCount: Number(row.cleared_count),
    clearedCents: Number(row.cleared_cents),
    pendingCents: Number(row.pending_cents),
    netCents: Number(row.net_cents),
    state: row.state || 'PROBATION',
    disabledReason: row.disabled_reason ?? null
  }));
}

function withDerived(row) {
  return {
    ...row,
    settlementRate: row.attempts ? Number((row.clearedCount / row.attempts).toFixed(4)) : 0,
    valuePerAttemptCents: row.attempts ? Math.round(row.clearedCents / row.attempts) : 0,
    roi: row.spendCents ? Number((row.clearedCents / row.spendCents).toFixed(4)) : null
  };
}

/**
 * The stopping rule.
 *
 * A rail that has consumed its probation budget or its attempt allowance without a
 * single verified settlement is not a rail. Without this the pipeline runs forever
 * on a market that does not pay, which is the failure mode the money-flow run
 * history already demonstrates.
 */
export async function evaluateRailViability({ rail, probationBudgetCents = 5000, minAttempts = 25 } = {}) {
  if (!rail) throw new Error('rail is required');
  const [economics] = await railEconomics(rail);
  const e = economics || withDerived({
    rail, attempts: 0, spendCents: 0, clearedCount: 0, clearedCents: 0, pendingCents: 0, netCents: 0
  });

  if (e.clearedCents > 0) {
    return {
      rail,
      verdict: 'CONTINUE',
      proven: true,
      reason: `${e.clearedCount} verified settlement(s) worth ${usd(e.clearedCents)} against ${usd(e.spendCents)} spend`,
      economics: e
    };
  }

  if (e.spendCents >= probationBudgetCents) {
    return {
      rail,
      verdict: 'DISABLE',
      proven: false,
      reason: `spent ${usd(e.spendCents)} of a ${usd(probationBudgetCents)} probation budget with zero verified settlements`,
      economics: e
    };
  }

  if (e.attempts >= minAttempts) {
    return {
      rail,
      verdict: 'DISABLE',
      proven: false,
      reason: `${e.attempts} attempts with zero verified settlements`,
      economics: e
    };
  }

  return {
    rail,
    verdict: 'CONTINUE',
    proven: false,
    reason: `on probation: ${usd(probationBudgetCents - e.spendCents)} and ${minAttempts - e.attempts} attempts remaining before automatic shutdown`,
    economics: e
  };
}

export async function getRailState(rail) {
  if (!databaseEnabled) return memory.rails.get(rail) || null;
  const result = await query('SELECT * FROM rail_state WHERE rail = $1', [rail]);
  return result.rows[0] || null;
}

/**
 * The only way a rail's state changes. `enabled` is derived (`state <> 'DISABLED'`)
 * rather than stored, in Postgres by a generated column and here by recomputing it
 * on every write, so there is exactly one place a rail's aliveness is decided.
 *
 * Entering PROBATION resets `probation_started_at` to now — the point of a manual
 * re-enable is a fresh budget, not an instant re-trip on spend the rail
 * accumulated before this call.
 */
export async function setRailState(rail, state, reason = null) {
  if (!rail) throw new Error('rail is required');
  if (!RAIL_STATES.includes(state)) throw new Error(`invalid rail state: ${state}. Must be one of ${RAIL_STATES.join(', ')}`);
  const now = new Date().toISOString();

  if (!databaseEnabled) {
    const existing = memory.rails.get(rail) || {};
    const enteringProbation = state === 'PROBATION' && existing.state !== 'PROBATION';
    const next = {
      rail,
      state,
      enabled: state !== 'DISABLED',
      disabled_reason: state === 'DISABLED' ? reason : null,
      probation_started_at: enteringProbation ? now : (existing.probation_started_at || now),
      probation_epoch: enteringProbation ? (Number(existing.probation_epoch) || 0) + 1 : (Number(existing.probation_epoch) || 0),
      state_changed_at: existing.state === state ? (existing.state_changed_at || now) : now
    };
    memory.rails.set(rail, next);
    return next;
  }

  const result = await query(`
    INSERT INTO rail_state(rail, state, disabled_reason)
    VALUES($1,$2,$3)
    ON CONFLICT (rail) DO UPDATE SET
      state = EXCLUDED.state,
      disabled_reason = CASE WHEN EXCLUDED.state = 'DISABLED' THEN EXCLUDED.disabled_reason ELSE NULL END,
      probation_started_at = CASE
        WHEN EXCLUDED.state = 'PROBATION' AND rail_state.state <> 'PROBATION' THEN now()
        ELSE rail_state.probation_started_at
      END,
      probation_epoch = CASE
        WHEN EXCLUDED.state = 'PROBATION' AND rail_state.state <> 'PROBATION' THEN rail_state.probation_epoch + 1
        ELSE rail_state.probation_epoch
      END,
      state_changed_at = CASE WHEN rail_state.state <> EXCLUDED.state THEN now() ELSE rail_state.state_changed_at END,
      updated_at = now()
    RETURNING *
  `, [rail, state, state === 'DISABLED' ? reason : null]);
  return result.rows[0];
}

/**
 * Spend and cleared revenue for a rail's CURRENT probation window, using the
 * exact epoch every attempt/settlement was stamped with rather than a timestamp
 * comparison — see the note on rail_state.probation_epoch in
 * db/migrations/010_rail_governor.sql for why timestamps are not safe here.
 */
export async function railProbationWindow(rail) {
  if (!rail) throw new Error('rail is required');
  const epoch = await currentEpoch(rail);

  if (!databaseEnabled) {
    const attempts = memory.attempts.filter(a => a.rail === rail && a.probationEpoch === epoch);
    const settlements = memory.settlements.filter(s => s.rail === rail && s.probationEpoch === epoch && s.status === SETTLEMENT_STATUS.CLEARED);
    const spendCents = attempts.reduce((sum, a) => sum + a.costCents, 0);
    const clearedCents = settlements.reduce((sum, s) => sum + s.netCents, 0);
    return { rail, epoch, spendCents, clearedCents, clearedCount: settlements.length, attempts: attempts.length };
  }

  const [attemptsResult, settlementsResult] = await Promise.all([
    query(`SELECT COUNT(*)::int AS attempts, COALESCE(SUM(cost_cents),0)::bigint AS spend_cents
           FROM rail_attempts WHERE rail=$1 AND probation_epoch=$2`, [rail, epoch]),
    query(`SELECT COUNT(*)::int AS cleared_count, COALESCE(SUM(net_cents),0)::bigint AS cleared_cents
           FROM settlements WHERE rail=$1 AND probation_epoch=$2 AND status='CLEARED'`, [rail, epoch])
  ]);
  return {
    rail, epoch,
    spendCents: Number(attemptsResult.rows[0].spend_cents),
    clearedCents: Number(settlementsResult.rows[0].cleared_cents),
    clearedCount: Number(settlementsResult.rows[0].cleared_count),
    attempts: Number(attemptsResult.rows[0].attempts)
  };
}

/**
 * Legacy two-state entry point, kept because most callers only ever ask "on or
 * off". `enabled: true` maps to PROBATION (a genuine fresh start — see
 * setRailState); `enabled: false` maps to DISABLED, the manual kill switch.
 */
export async function setRailEnabled(rail, enabled, disabledReason = null) {
  return setRailState(rail, enabled ? 'PROBATION' : 'DISABLED', enabled ? null : disabledReason);
}

export async function isRailEnabled(rail) {
  const state = await getRailState(rail);
  return state ? Boolean(state.enabled) : true;
}

/**
 * Spend and cleared revenue for one rail within [since, now].
 *
 * Powers the governor's rolling-window transitions (a manually re-enabled rail's
 * probation window, a PROVEN rail's trailing-30-day ROI). Settlements are counted
 * by `verified_at` — when the money actually cleared — while attempts are counted
 * by `started_at` — when the spend happened.
 */
export async function railWindow(rail, sinceIso) {
  if (!rail) throw new Error('rail is required');
  const since = sinceIso || new Date(0).toISOString();

  if (!databaseEnabled) {
    const attempts = memory.attempts.filter(a => a.rail === rail && a.startedAt >= since);
    const settlements = memory.settlements.filter(s => s.rail === rail && s.status === SETTLEMENT_STATUS.CLEARED && s.verifiedAt && s.verifiedAt >= since);
    const spendCents = attempts.reduce((sum, a) => sum + a.costCents, 0);
    const clearedCents = settlements.reduce((sum, s) => sum + s.netCents, 0);
    return {
      rail, since, spendCents, clearedCents, clearedCount: settlements.length, attempts: attempts.length,
      roi: spendCents ? Number((clearedCents / spendCents).toFixed(4)) : null
    };
  }

  const [attemptsResult, settlementsResult] = await Promise.all([
    query(`SELECT COUNT(*)::int AS attempts, COALESCE(SUM(cost_cents),0)::bigint AS spend_cents
           FROM rail_attempts WHERE rail=$1 AND started_at >= $2`, [rail, since]),
    query(`SELECT COUNT(*)::int AS cleared_count, COALESCE(SUM(net_cents),0)::bigint AS cleared_cents
           FROM settlements WHERE rail=$1 AND status='CLEARED' AND verified_at >= $2`, [rail, since])
  ]);
  const spendCents = Number(attemptsResult.rows[0].spend_cents);
  const clearedCents = Number(settlementsResult.rows[0].cleared_cents);
  return {
    rail, since, spendCents, clearedCents,
    clearedCount: Number(settlementsResult.rows[0].cleared_count),
    attempts: Number(attemptsResult.rows[0].attempts),
    roi: spendCents ? Number((clearedCents / spendCents).toFixed(4)) : null
  };
}

/** Evaluate a rail and actually shut it off when it has failed to pay. */
export async function enforceRailViability(options) {
  const verdict = await evaluateRailViability(options);
  if (verdict.verdict === 'DISABLE') {
    await setRailEnabled(verdict.rail, false, verdict.reason);
  }
  return verdict;
}

export function ledgerStorageMode() { return databaseEnabled ? 'postgres' : 'memory'; }

export function resetLedgerMemory() {
  memory.rails.clear();
  memory.attempts.length = 0;
  memory.settlements.length = 0;
}

export async function resetLedgerStore() {
  resetLedgerMemory();
  if (databaseEnabled) {
    await query('TRUNCATE rail_attempts, settlements, rail_state CASCADE');
  }
}

