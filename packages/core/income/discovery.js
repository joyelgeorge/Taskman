import { databaseEnabled, query } from '@taskman/db';
import { listStreams, registerStream } from './streams.js';
import { listDataProducts } from './data-products.js';

/**
 * Finds new ways this system could earn — from evidence it already holds, never
 * from a prompt.
 *
 * The temptation here is a cron that asks a model "what are some income ideas".
 * That is precisely the closed loop this project exists to avoid: an answer
 * available by prompting is available to everyone holding the same model, and is
 * arbitraged to zero the moment it is generated (docs/TARGET_DESIGN.md §1). The
 * discover worker refuses to call a model for the same reason, and so does this.
 *
 * So every detector below reads real rows — scans, rollups, signals, settlements
 * — and every candidate it emits carries the row references that justify it. A
 * proposal nobody can trace back to evidence is not a proposal, it is a guess
 * with a schema.
 *
 * Detectors only ever propose. Nothing here promotes, enables, or spends: a
 * candidate lands as HYPOTHESIS and waits for judgement.
 */

/** A pattern must recur across this many distinct days before it is a signal. */
const RECURRENCE_DAYS = 3;
/** Coverage at which an unarchived series is worth declaring as a product. */
const SERIES_MATURITY_DAYS = 30;

/** Explicit, auditable demand vocabulary. Deliberately not learned or generated. */
const DEMAND_PATTERNS = Object.freeze([
  { key: 'bookkeeping', match: /\b(bookkeep|reconcil|invoic|accounts payable|accounts receivable)\w*/i },
  { key: 'migration', match: /\b(migrat|port(ing)?|upgrade)\w*\s+(from|to)\b/i },
  { key: 'scraping-etl', match: /\b(scrap\w+|etl|data pipeline|csv import)\b/i },
  { key: 'audit', match: /\b(audit|leakage|unclaimed|overcharge|refund)\w*/i }
]);

const fingerprintFor = (detector, key) => `${detector}:${key}`;

/**
 * A venue that used to be closed and is now open.
 *
 * The scan history exists precisely so "when does a blocked lane become worth
 * retrying" is answered by measurement rather than by trying again periodically
 * and hoping. A target whose latest scan is reachable and undefended, where an
 * earlier scan was not, is the one moment that question has a yes.
 */
export async function detectOpenedVenues() {
  if (!databaseEnabled) return [];
  const result = await query(`
    WITH ranked AS (
      SELECT target_key, target_url, reachable, bot_defended, verdict, scanned_at,
             ROW_NUMBER() OVER (PARTITION BY target_key ORDER BY scanned_at DESC) AS rn
      FROM satellite_scans
    ),
    latest AS (SELECT * FROM ranked WHERE rn = 1),
    earlier AS (
      SELECT target_key, bool_or(bot_defended OR NOT reachable) AS was_closed
      FROM ranked WHERE rn > 1 GROUP BY target_key
    )
    SELECT l.target_key, l.target_url, l.verdict, l.scanned_at
    FROM latest l JOIN earlier e ON e.target_key = l.target_key
    WHERE l.reachable AND NOT l.bot_defended AND e.was_closed
  `);
  return result.rows.map(row => ({
    detector: 'venue-opened',
    fingerprint: fingerprintFor('venue-opened', row.target_key),
    streamKey: `venue-${row.target_key}`,
    title: `${row.target_key} became reachable and undefended`,
    mechanism: 'Work sourced from this venue, paid by whatever payout method it operates.',
    requires: 'That the venue actually carries paid work, and that its terms permit automated participation.',
    nextAction: `Read ${row.target_url} terms, then price one real task before building anything.`,
    unblockedBy: 'human',
    testCostHours: 2,
    evidence: [{ kind: 'satellite_scan', targetKey: row.target_key, verdict: row.verdict, at: row.scanned_at }]
  }));
}

/**
 * An unarchived series that has accumulated real coverage but nothing declares
 * it. Time has already been spent collecting it; this is what turns that into a
 * named asset rather than rows nobody claims.
 */
export async function detectMaturingSeries() {
  if (!databaseEnabled) return [];
  const declared = new Set((await listDataProducts()).flatMap(p => p.seriesKeys));
  const result = await query(`
    SELECT r.series_key, count(DISTINCT r.bucket_date)::int AS days
    FROM observation_rollups r
    JOIN observations o ON o.series_key = r.series_key
    JOIN observation_sources s ON s.source_key = o.source_key
    WHERE s.reconstructible IS FALSE
    GROUP BY r.series_key
    HAVING count(DISTINCT r.bucket_date) >= $1
  `, [SERIES_MATURITY_DAYS]);

  const undeclared = result.rows.filter(row => !declared.has(row.series_key));
  if (undeclared.length === 0) return [];
  return [{
    detector: 'unarchived-series-matured',
    fingerprint: fingerprintFor('unarchived-series-matured', undeclared.map(r => r.series_key).sort().join(',')),
    streamKey: `dataset-${undeclared[0].series_key.split('.')[0]}`,
    title: `${undeclared.length} unarchived series past ${SERIES_MATURITY_DAYS} days with no product declared`,
    mechanism: 'Licence the accumulated history to a buyer who cannot obtain it anywhere else.',
    requires: 'A named buyer with a decision this history changes. Coverage alone is not demand.',
    nextAction: 'Declare a data product over these series, or stop collecting them.',
    unblockedBy: 'machine',
    testCostHours: 1,
    evidence: undeclared.map(r => ({ kind: 'series', seriesKey: r.series_key, days: r.days }))
  }];
}

/**
 * Demand that keeps recurring in collected signals.
 *
 * Weak evidence, and treated as such: a keyword match on a title is not proof
 * anyone will pay. Recurrence across distinct days is the whole filter — it is
 * what separates a standing pattern from one post that went around once — and
 * the result lands as a HYPOTHESIS for a person to judge, never as work.
 */
export async function detectRecurringDemand() {
  if (!databaseEnabled) return [];
  const result = await query(`
    SELECT id, title, observed_at FROM signals
    WHERE title IS NOT NULL AND status <> 'QUARANTINED'
  `);
  const candidates = [];

  for (const pattern of DEMAND_PATTERNS) {
    const hits = result.rows.filter(row => pattern.match.test(row.title));
    const days = new Set(hits.map(h => new Date(h.observed_at).toISOString().slice(0, 10)));
    if (days.size < RECURRENCE_DAYS) continue;
    candidates.push({
      detector: 'recurring-demand',
      fingerprint: fingerprintFor('recurring-demand', pattern.key),
      streamKey: `demand-${pattern.key}`,
      title: `"${pattern.key}" demand recurring across ${days.size} days`,
      mechanism: 'Paid delivery of this work, invoiced directly or through a marketplace.',
      requires: `That these ${hits.length} mentions represent people who pay, not people discussing. `
        + 'A title match is weak evidence and this has not been verified.',
      nextAction: `Read the ${Math.min(hits.length, 5)} most recent matches and find one that names a budget.`,
      unblockedBy: 'human',
      testCostHours: 1,
      evidence: hits.slice(0, 10).map(h => ({ kind: 'signal', id: h.id, title: h.title }))
    });
  }
  return candidates;
}

/**
 * Money that arrived from something no stream claims.
 *
 * The highest-priority detector by a wide margin: it means the system earned and
 * does not know why. Everything else here is a guess about the future; this is a
 * settled fact about the past that the portfolio failed to represent.
 */
export async function detectUnattributedSettlements() {
  if (!databaseEnabled) return [];
  const claimed = new Set((await listStreams({})).map(s => s.streamKey));
  const result = await query(`
    SELECT rail, count(*)::int AS n, sum(gross_cents - fee_cents)::bigint AS net_cents,
           min(external_ref) AS a_ref
    FROM settlements WHERE status = 'CLEARED' GROUP BY rail
  `);
  return result.rows
    .filter(row => !claimed.has(row.rail) && !claimed.has(`rail-${row.rail}`))
    .map(row => ({
      detector: 'unattributed-settlement',
      fingerprint: fingerprintFor('unattributed-settlement', row.rail),
      streamKey: `rail-${row.rail}`,
      title: `${row.rail} has cleared money that no stream claims`,
      mechanism: `Already settling: ${row.n} cleared settlement(s), ${row.net_cents} net cents.`,
      requires: 'Nothing — this has already happened. The portfolio simply did not represent it.',
      nextAction: `Attribute these settlements to a stream; reference ${row.a_ref}.`,
      unblockedBy: 'machine',
      testCostHours: 0,
      evidence: [{ kind: 'settlement', rail: row.rail, count: row.n, externalRef: row.a_ref }]
    }));
}

export const DETECTORS = Object.freeze([
  detectUnattributedSettlements,
  detectOpenedVenues,
  detectMaturingSeries,
  detectRecurringDemand
]);

/**
 * Runs every detector and records what is new.
 *
 * A candidate whose fingerprint already exists is skipped rather than updated,
 * which is what makes a DISPROVEN stream stay disproven: the row is still there,
 * so re-proposing it is a no-op and the system cannot argue itself back into a
 * lane it already killed by measurement.
 */
export async function discoverIncomeStreams({ now = new Date(), detectors = DETECTORS } = {}) {
  const existing = await listStreams({});
  const seenFingerprints = new Set(existing.map(s => s.fingerprint).filter(Boolean));
  const seenKeys = new Set(existing.map(s => s.streamKey));

  const proposed = [];
  const errors = [];

  for (const detector of detectors) {
    let candidates = [];
    try {
      candidates = await detector();
    } catch (error) {
      // One broken detector must not stop the rest, and must not look like "no
      // candidates found" either.
      errors.push({ detector: detector.name, error: String(error.message || error).slice(0, 200) });
      continue;
    }
    for (const candidate of candidates) {
      if (seenFingerprints.has(candidate.fingerprint) || seenKeys.has(candidate.streamKey)) continue;
      seenFingerprints.add(candidate.fingerprint);
      seenKeys.add(candidate.streamKey);
      await registerStream({
        ...candidate,
        state: 'HYPOTHESIS',
        stateReason: `proposed by ${candidate.detector} from recorded evidence on ${now.toISOString().slice(0, 10)}`,
        origin: 'discovered',
        discoveredAt: now
      });
      proposed.push(candidate);
    }
  }

  return {
    detectorsRun: detectors.length,
    proposed: proposed.length,
    proposals: proposed.map(p => ({ streamKey: p.streamKey, detector: p.detector, title: p.title })),
    errors,
    // Said plainly, because a discovery run that finds nothing is the normal case
    // and should not read as a failure.
    note: proposed.length === 0
      ? 'No new evidence-backed stream this run. Detectors propose only from recorded rows, never from a prompt.'
      : `${proposed.length} new stream(s) proposed from evidence, each awaiting judgement.`
  };
}
