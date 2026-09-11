import { randomUUID } from 'node:crypto';
import { databaseEnabled, query } from './db.js';
import { scrubSecrets } from './adapters/coding-agent-adapter.js';

/**
 * A record that an attempt was made.
 *
 * This is the smallest missing piece in the whole repository. Kill criteria
 * exist — commercial-wedge.js retires the wedge after 50 attempts with zero
 * conversions, rail-governor derives its own thresholds — and none of them can
 * ever fire, because nothing has ever counted an attempt. acquisition-funnel.js
 * names the stages and holds them in memory, so they vanish with the process.
 *
 * The cost of that is not bookkeeping. With no count, "we tried and it did not
 * work" and "nobody tried" are indistinguishable from inside this repo, and when
 * those two cannot be told apart the default is always to build — because
 * building is the half that can be observed. A week of 137 commits and zero
 * settlements is what that looks like (docs/WHY-NO-MONEY-YET.md).
 *
 * So: one row per message actually sent to an actual person. Not a plan to send
 * one.
 */

export const OUTREACH_OUTCOME = Object.freeze({
  /** Sent; nothing back yet. */
  PENDING: 'PENDING',
  /** Enough time has passed that silence is the answer. */
  NO_RESPONSE: 'NO_RESPONSE',
  /** They answered. */
  REPLIED: 'REPLIED',
  /** They answered no. */
  DECLINED: 'DECLINED',
  /** They ran the tool, asked for the work, or otherwise leaned in. */
  INTERESTED: 'INTERESTED',
  /** Money arrived. Record the settlement through money-ledger.js as well. */
  PAID: 'PAID'
});

/** Outcomes that prove a human answered. PAID implies REPLIED. */
const RESPONDED = new Set([
  OUTREACH_OUTCOME.REPLIED, OUTREACH_OUTCOME.DECLINED,
  OUTREACH_OUTCOME.INTERESTED, OUTREACH_OUTCOME.PAID
]);

/** commercial-wedge.js: "...after 50 attempts with zero converted customers". */
export const KILL_AFTER_ATTEMPTS = 50;

const mem = { attempts: [] };
const nowIso = () => new Date().toISOString();

const normalize = (row) => row && ({
  id: row.id,
  lane: row.lane,
  channel: row.channel,
  prospect: row.prospect,
  outcome: row.outcome,
  note: row.note ?? null,
  attemptedAt: row.attempted_at ?? row.attemptedAt,
  respondedAt: row.responded_at ?? row.respondedAt ?? null
});

/**
 * Log one attempt. Returns the row, with `duplicate: true` when this prospect
 * has already been contacted on this channel for this lane — contacting the
 * same person twice is a fact worth surfacing, not an error worth throwing.
 */
export async function logOutreachAttempt({ lane, channel, prospect, note = null, now = nowIso } = {}) {
  if (!lane) throw new Error('lane is required — which offer was this');
  if (!channel) throw new Error('channel is required — where the message went');
  if (!prospect) throw new Error('prospect is required — a handle or thread URL, so it is checkable');

  // A free-text note is permanent storage like any other.
  const cleanNote = note == null ? null : scrubSecrets(String(note));
  const attemptedAt = typeof now === 'function' ? now() : nowIso();

  if (!databaseEnabled) {
    const existing = mem.attempts.find(
      a => a.lane === lane && a.channel === channel && a.prospect === prospect);
    if (existing) return { ...normalize(existing), duplicate: true };
    const row = {
      id: randomUUID(), lane, channel, prospect,
      outcome: OUTREACH_OUTCOME.PENDING, note: cleanNote,
      attemptedAt, respondedAt: null
    };
    mem.attempts.push(row);
    return { ...normalize(row), duplicate: false };
  }

  const { rows: found } = await query(
    `SELECT * FROM outreach_attempts WHERE lane = $1 AND channel = $2 AND prospect = $3`,
    [lane, channel, prospect]);
  if (found[0]) return { ...normalize(found[0]), duplicate: true };

  const { rows } = await query(
    `INSERT INTO outreach_attempts (id, lane, channel, prospect, outcome, note, attempted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [randomUUID(), lane, channel, prospect, OUTREACH_OUTCOME.PENDING, cleanNote, attemptedAt]);
  return { ...normalize(rows[0]), duplicate: false };
}

export async function updateOutreachOutcome(id, outcome, { now = nowIso } = {}) {
  if (!Object.values(OUTREACH_OUTCOME).includes(outcome)) {
    throw new Error(`invalid outcome "${outcome}" — must be one of ${Object.values(OUTREACH_OUTCOME).join(', ')}`);
  }
  const respondedAt = RESPONDED.has(outcome) ? (typeof now === 'function' ? now() : nowIso()) : null;

  if (!databaseEnabled) {
    const row = mem.attempts.find(a => a.id === id);
    if (!row) return null;
    row.outcome = outcome;
    row.respondedAt = respondedAt;
    return normalize(row);
  }
  const { rows } = await query(
    `UPDATE outreach_attempts SET outcome = $2, responded_at = $3 WHERE id = $1 RETURNING *`,
    [id, outcome, respondedAt]);
  return normalize(rows[0] || null);
}

export async function listOutreachAttempts({ lane = null } = {}) {
  if (!databaseEnabled) {
    return mem.attempts.filter(a => !lane || a.lane === lane).map(normalize);
  }
  const { rows } = lane
    ? await query('SELECT * FROM outreach_attempts WHERE lane = $1 ORDER BY attempted_at DESC', [lane])
    : await query('SELECT * FROM outreach_attempts ORDER BY attempted_at DESC');
  return rows.map(normalize);
}

/**
 * What the kill criteria need, and the sentence a human should read.
 *
 * Zero attempts is reported as untried rather than as failure. That distinction
 * is the entire point of this module.
 */
export async function outreachSummary(lane) {
  const attempts = await listOutreachAttempts({ lane });
  const replies = attempts.filter(a => RESPONDED.has(a.outcome)).length;
  const paid = attempts.filter(a => a.outcome === OUTREACH_OUTCOME.PAID).length;
  const killCriterionReached = attempts.length >= KILL_AFTER_ATTEMPTS && paid === 0;

  let verdict;
  if (attempts.length === 0) {
    verdict = `${lane}: no attempts recorded — this lane has not been tried, which is not the same as failed`;
  } else if (paid > 0) {
    verdict = `${lane}: ${paid} paid of ${attempts.length} attempts — the lane converts`;
  } else if (killCriterionReached) {
    verdict = `${lane}: ${attempts.length} attempts, ${replies} replies, zero paid — past the `
      + `${KILL_AFTER_ATTEMPTS} attempts kill criterion. Record the disproof and stop.`;
  } else {
    verdict = `${lane}: ${attempts.length} attempts, ${replies} replies, zero paid — `
      + `${KILL_AFTER_ATTEMPTS - attempts.length} before the kill criterion`;
  }

  return { lane, attempts: attempts.length, replies, paid, killCriterionReached, verdict };
}

export function resetOutreachLogForTesting() {
  mem.attempts.length = 0;
}
