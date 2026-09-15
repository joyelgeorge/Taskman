/**
 * The vocabulary that stops a session believing a false zero.
 *
 * `src/money-ledger.js` returns an empty array when no database is configured,
 * which is byte-identical to the answer from a reachable database holding zero
 * rows. Today that is harmless, because the true settlement count is zero either
 * way. The day the first payment clears, a session without DATABASE_URL reports
 * $0, states it with confidence, and every claim built on it inherits the error.
 *
 * So a read that depends on a store carries how the store answered:
 *
 *   verified — the store answered, and holds data
 *   empty    — the store answered, and holds nothing. A zero you may quote.
 *   unknown  — the store could not answer. There is no count, and asking for
 *              one gets null rather than a number that would be believed.
 *
 * Memory mode is a legitimate configured mode (CLAUDE.md rule 4) and this does
 * not change it. What it changes is that the caller can now tell which mode
 * answered, which is the part that was missing.
 */

export const STORE_STATE = Object.freeze({
  VERIFIED: 'verified',
  EMPTY: 'empty',
  UNKNOWN: 'unknown'
});

function unknown(label, reason) {
  return { label, state: STORE_STATE.UNKNOWN, count: null, rows: null, reason };
}

/**
 * Read one store and report how it answered.
 *
 * `read` is never called when `enabled` is false — an unconfigured store has
 * nothing to say, and calling a fallback is how the empty array got returned in
 * the first place.
 */
export async function readStore({ label, enabled, read }) {
  if (!enabled) return unknown(label, `${label}: database not configured`);

  let rows;
  try {
    rows = await read();
  } catch (error) {
    return unknown(label, `${label}: unreachable — ${String(error?.message || error)}`);
  }

  const list = Array.isArray(rows) ? rows : [rows];
  return {
    label,
    state: list.length ? STORE_STATE.VERIFIED : STORE_STATE.EMPTY,
    count: list.length,
    rows: list,
    reason: null
  };
}

/** True when any store could not answer, so a caller can refuse to report a position. */
export function anyUnknown(results = []) {
  return results.some(r => r?.state === STORE_STATE.UNKNOWN);
}
