import { databaseEnabled, query, truncateForTesting } from './db.js';
import { readStore } from './store-state.js';

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
/**
 * How long each rail actually takes to pay, from its own published terms.
 *
 * These are not tuning knobs. Every value is the platform's stated clearing
 * period, and the governor treats an attempt younger than this as pending rather
 * than as evidence of failure. Without it, twenty-five delivered orders in week
 * one read as twenty-five failures on day seven, and the rail is disabled the
 * week before its first payment lands.
 *
 * When a rail is not listed the default is deliberately the slowest common term
 * rather than the fastest: being slow to disable costs a little budget, being
 * quick to disable costs the lane.
 */
export const SETTLEMENT_LAG_DAYS = Object.freeze({
  fiverr: 14,        // cleared 14 days after order completion (7 for Top Rated)
  upwork: 10,        // 5-day security period plus payout transit
  stripe: 7,         // rolling payout, 2-7 days depending on account age and country
  paypal: 3,
  invoice: 30        // net-30 is the ordinary commercial term
});

export const DEFAULT_SETTLEMENT_LAG_DAYS = 30;

export function settlementLagFor(rail) {
  return SETTLEMENT_LAG_DAYS[String(rail || '').toLowerCase()] ?? DEFAULT_SETTLEMENT_LAG_DAYS;
}

/**
 * Where a settlement can come from and still count as money.
 *
 * The test is not which company processed it — it is whether an outside system
 * holds a record this one can be checked against. A PayPal transaction id meets
 * that as squarely as a Stripe payment intent: it is issued by the processor,
 * appears in both parties' history, and can be reconciled against a bank credit
 * later.
 *
 * It is listed explicitly rather than folded into manual_receipt, which exists
 * for cash and cheques — the weakest category, where the only record is one the
 * operator wrote themselves. Booking a real processor payment there would
 * understate how verifiable it is, and the whole point of this list is that the
 * category matches the strength of the evidence.
 */
export const VERIFIED_SOURCES = Object.freeze(['stripe', 'paypal', 'bank', 'manual_receipt']);

/**
 * How a settlement came to be believed cleared.
 *
 * This list exists because `source` and `externalRef` turned out not to be
 * enough. On 2026-09-11 a $220 settlement was recorded CLEARED for a customer
 * who did not exist (commit 0cee5ec). It did not bypass this module — it passed
 * it. `'stripe'` is on the list above, and `'pi_fiverr_audit_apex_201_cleared'`
 * is non-empty and shaped like a payment intent. Both checks looked at the
 * *form* of the claim. Neither looked at whether anything outside this process
 * agreed with it, and `verifiedAt` was then stamped from the caller's own
 * assertion that the status was CLEARED — so "verified" meant "asserted".
 *
 * Note what is deliberately NOT the fix: tightening the reference format.
 * A generator that produces plausible strings defeats any format check, so a
 * stricter pattern would buy a speed bump and re-hide the same hole. The only
 * property worth enforcing is that *something outside this process observed the
 * money*, and that has to be named rather than inferred.
 *
 * Ordered strongest to weakest. `operator_receipt` is honest about being a
 * human's word — cash and cheques have no other record — and is kept distinct
 * precisely so it never reads as processor-confirmed.
 */
export const CONFIRMATION_METHODS = Object.freeze([
  'provider_api',     // the processor was queried and returned this transaction
  'bank_statement',   // the credit was read off a statement or export
  'operator_receipt'  // a person saw the money arrive; the weakest evidence there is
]);

/**
 * Money may only be called cleared on the word of something outside this
 * process. Returns the normalized confirmation, or null for a non-cleared row.
 */
function assertConfirmation(status, confirmation) {
  if (status !== SETTLEMENT_STATUS.CLEARED) return null;

  const method = confirmation?.method;
  if (!CONFIRMATION_METHODS.includes(method)) {
    throw new Error(
      `a cleared settlement needs confirmation.method (one of ${CONFIRMATION_METHODS.join(', ')}): `
      + 'an agent\'s belief that money arrived is not an observation that it did'
    );
  }

  const observedAt = confirmation?.observedAt;
  if (!observedAt || Number.isNaN(new Date(observedAt).getTime())) {
    throw new Error('confirmation.observedAt is required: when the outside system saw the money, not when this row was written');
  }

  return {
    method,
    observedAt: new Date(observedAt).toISOString(),
    reference: confirmation.reference ? String(confirmation.reference).trim() : null,
    detail: confirmation.detail ?? null
  };
}

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

/** Timestamps cross the two storage modes as different types; normalize to ISO. */
const isoOrNull = value => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

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
    // PostgreSQL hands back a Date for timestamptz while memory mode holds the
    // ISO string it was given. Callers compare this field, so the two modes have
    // to agree on its type as well as its value.
    verifiedAt: isoOrNull(row.verifiedAt ?? row.verified_at),
    verification: row.verification || {},
    // Surfaced from the verification payload so callers can read how this row
    // came to be trusted without knowing where it is stored.
    confirmation: (row.verification || {}).confirmation ?? null,
    createdAt: row.createdAt || row.created_at || null,
    probationEpoch: Number(row.probationEpoch ?? row.probation_epoch ?? 0)
  };
}

/** The probation epoch currently active for a rail; 0 for a rail with no state row. */
async function currentEpoch(rail) {
  const state = await getRailState(rail);
  return Number(state?.probation_epoch ?? 0);
}

export async function recordAttempt({
  rail, candidateKey = null, stage = 'EXECUTE', costCents = 0, evidence = {},
  // Explicit when backfilling a historical attempt, or when a caller records one
  // after the fact. The governor now judges maturity by this timestamp, so it has
  // to reflect when the work actually happened rather than when it was written.
  startedAt = null
}) {
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
    started_at: startedAt ? new Date(startedAt).toISOString() : new Date().toISOString(),
    probation_epoch: epoch
  });

  if (!databaseEnabled) {
    memory.attempts.push(attempt);
    return attempt;
  }

  const result = await query(
    `INSERT INTO rail_attempts(id, rail, candidate_key, stage, status, cost_cents, evidence, probation_epoch, started_at)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING *`,
    [attempt.id, rail, candidateKey, stage, attempt.status, attempt.costCents, JSON.stringify(evidence), epoch, attempt.startedAt]
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
  verification = {},
  confirmation = null
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

  // Throws if the caller asked for CLEARED without an outside observation.
  // A settlement recorded without one is still welcome — it just stays PENDING,
  // which is the honest description of money nobody has seen arrive.
  const confirmed = assertConfirmation(status, confirmation);

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
    // When the outside system saw the money — never when this row was written.
    verified_at: confirmed ? confirmed.observedAt : null,
    verification: confirmed ? { ...verification, confirmation: confirmed } : verification,
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
     settlement.feeCents, settlement.currency, settlement.status, settlement.verifiedAt, JSON.stringify(settlement.verification), epoch]
  );
  return normalizeSettlement(result.rows[0]);
}

/**
 * Promote a pending settlement to cleared.
 *
 * Takes the same confirmation as `recordSettlement` and for the same reason:
 * this was previously the easier door into the same room, stamping
 * `verified_at = now()` on nothing but the fact that it had been called.
 */
export async function markSettlementCleared(source, externalRef, verification = {}, confirmation = null) {
  const confirmed = assertConfirmation(SETTLEMENT_STATUS.CLEARED, confirmation);

  if (!databaseEnabled) {
    const settlement = memory.settlements.find(s => s.source === source && s.externalRef === externalRef);
    if (!settlement) return null;
    settlement.status = SETTLEMENT_STATUS.CLEARED;
    settlement.verifiedAt = confirmed.observedAt;
    settlement.verification = { ...settlement.verification, ...verification, confirmation: confirmed };
    settlement.confirmation = confirmed;
    return settlement;
  }
  const result = await query(
    `UPDATE settlements SET status=$3, verified_at=$5, verification = verification || $4::jsonb
     WHERE source=$1 AND external_ref=$2 RETURNING *`,
    [source, externalRef, SETTLEMENT_STATUS.CLEARED,
     JSON.stringify({ ...verification, confirmation: confirmed }), confirmed.observedAt]
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

/**
 * The settlement position, carrying how the ledger answered.
 *
 * `listSettlements` below returns an empty array when no database is configured,
 * which is byte-identical to the answer from a reachable database holding zero
 * rows. That is harmless only while the true count is zero. Ask through this
 * when the answer will be reported as fact — it returns `unknown` with a null
 * count rather than a zero somebody would quote.
 */
export async function settlementPosition({ enabled = databaseEnabled, read = null } = {}) {
  return readStore({
    label: 'settlements',
    enabled,
    read: read || (async () => (await query('SELECT * FROM settlements')).rows)
  });
}

/**
 * Memory-mode reads in this module.
 *
 * The `if (!databaseEnabled)` branches below (listSettlements, listAttempts and
 * friends) return in-memory data that a caller cannot, on its own, tell apart
 * from a verified database answer. Our own scanner flags this exact pattern —
 * findStorageDivergence in codebase-audit.js counts 11 here.
 *
 * They are left as-is on purpose. The dangerous case — the settlement position
 * being REPORTED as fact — goes through settlementPosition() above, which carries
 * a verified/empty/unknown state (src/store-state.js). Every reporting surface
 * (scripts/brief.mjs, scripts/next.mjs) reads through that vocabulary, verified
 * 2026-09-15, so no number a session states is sourced from a raw memory read.
 *
 * The rest are convenience reads no session quotes. Converting all of them would
 * churn return shapes the suite asserts against for no live risk. If a NEW
 * reporting surface needs one of these, give it a store state at that point —
 * not pre-emptively.
 */
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
export async function railProbationWindow(rail, { settlementLagDays = DEFAULT_SETTLEMENT_LAG_DAYS } = {}) {
  if (!rail) throw new Error('rail is required');
  const epoch = await currentEpoch(rail);

  // Attempts old enough that money would have arrived by now if it was going to.
  //
  // An attempt made yesterday proves nothing about whether a rail settles: Fiverr
  // holds cleared funds 14 days, Stripe pays out on a 2-7 day rolling basis, an
  // invoice is net-30. Counting a young attempt as evidence of failure is how the
  // governor kills a lane in the week it starts working, immediately before the
  // first payment lands — and recovery from DISABLED is manual only.
  const cutoff = new Date(Date.now() - settlementLagDays * 86_400_000);

  if (!databaseEnabled) {
    const attempts = memory.attempts.filter(a => a.rail === rail && a.probationEpoch === epoch);
    const settlements = memory.settlements.filter(s => s.rail === rail && s.probationEpoch === epoch && s.status === SETTLEMENT_STATUS.CLEARED);
    const spendCents = attempts.reduce((sum, a) => sum + a.costCents, 0);
    const clearedCents = settlements.reduce((sum, s) => sum + s.netCents, 0);
    const maturedAttempts = attempts.filter(a => new Date(a.startedAt ?? a.attemptedAt ?? 0) <= cutoff).length;
    return {
      rail, epoch, spendCents, clearedCents, clearedCount: settlements.length,
      attempts: attempts.length,
      maturedAttempts,
      pendingAttempts: attempts.length - maturedAttempts,
      settlementLagDays
    };
  }

  const [attemptsResult, settlementsResult] = await Promise.all([
    query(`SELECT COUNT(*)::int AS attempts, COALESCE(SUM(cost_cents),0)::bigint AS spend_cents,
                  COUNT(*) FILTER (WHERE started_at <= $3::timestamptz)::int AS matured_attempts
           FROM rail_attempts WHERE rail=$1 AND probation_epoch=$2`, [rail, epoch, cutoff.toISOString()]),
    query(`SELECT COUNT(*)::int AS cleared_count, COALESCE(SUM(net_cents),0)::bigint AS cleared_cents
           FROM settlements WHERE rail=$1 AND probation_epoch=$2 AND status='CLEARED'`, [rail, epoch])
  ]);
  return {
    rail, epoch,
    spendCents: Number(attemptsResult.rows[0].spend_cents),
    clearedCents: Number(settlementsResult.rows[0].cleared_cents),
    clearedCount: Number(settlementsResult.rows[0].cleared_count),
    maturedAttempts: Number(attemptsResult.rows[0].matured_attempts),
    pendingAttempts: Number(attemptsResult.rows[0].attempts) - Number(attemptsResult.rows[0].matured_attempts),
    settlementLagDays,
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

export async function resetLedgerMemory() {
  memory.rails.clear();
  memory.attempts.length = 0;
  memory.settlements.length = 0;
  await truncateForTesting(['settlements', 'rail_attempts', 'rail_state']);
}
