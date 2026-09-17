import { randomUUID } from 'node:crypto';
import { databaseEnabled, query, truncateForTesting } from './db.js';
import { scrubSecrets } from './adapters/coding-agent-adapter.js';
import { EVIDENCE_TIER } from './evidence-tier.js';

/**
 * What a research pass found, kept past the session that found it.
 *
 * The vibe-app sweep wrote its results to /tmp and lost them. That is the whole
 * argument for this file. A finding that lives only in a transcript dies with
 * it, and the next session either pays to rediscover it or — worse —
 * half-remembers one and states it as fact.
 *
 * Two rules do the work:
 *
 *   A note without a source is a HYPOTHESIS. Not refused: an unbacked hunch is
 *   the raw material of discovery and this project's own evidence-tier module
 *   exists because gating novelty was the wrong instinct. It is labelled, so
 *   nobody later mistakes it for something that was checked.
 *
 *   A note may not claim CONFIRMED without a source. That direction is refused,
 *   because the whole point of the tier is that somebody could go and look.
 */

const mem = { notes: [] };
const nowIso = () => new Date().toISOString();

const normalize = (row) => row && ({
  id: row.id,
  claim: row.claim,
  tier: row.tier,
  source: row.source ?? null,
  lane: row.lane ?? null,
  recordedAt: row.recorded_at ?? row.recordedAt
});

/**
 * Record one finding. `source` is anything a later reader could check: a URL, a
 * file and line, a command and what it printed.
 */
export async function recordResearchNote({
  claim, source = null, tier = null, lane = null, now = nowIso
} = {}) {
  if (!claim || !String(claim).trim()) {
    throw new Error('claim is required — a note with nothing asserted records nothing');
  }

  const cleanSource = source == null ? null : scrubSecrets(String(source)).trim() || null;
  const resolvedTier = tier || (cleanSource ? EVIDENCE_TIER.REFERENCED : EVIDENCE_TIER.HYPOTHESIS);

  if (resolvedTier !== EVIDENCE_TIER.HYPOTHESIS && !cleanSource) {
    throw new Error(
      `a ${resolvedTier} note needs a source — without one it is a HYPOTHESIS, and saying otherwise is the fabrication this log exists to prevent`
    );
  }

  const row = {
    id: randomUUID(),
    claim: scrubSecrets(String(claim)).trim(),
    tier: resolvedTier,
    source: cleanSource,
    lane,
    recordedAt: typeof now === 'function' ? now() : nowIso()
  };

  if (!databaseEnabled) {
    mem.notes.push(row);
    return normalize(row);
  }

  const { rows } = await query(
    `INSERT INTO research_notes (id, claim, tier, source, lane, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [row.id, row.claim, row.tier, row.source, row.lane, row.recordedAt]);
  return normalize(rows[0]);
}

/** Newest first — the order a session reads them in. */
export async function listResearchNotes({ lane = null, limit = 200 } = {}) {
  if (!databaseEnabled) {
    return mem.notes
      .filter(n => !lane || n.lane === lane)
      .slice(-limit).reverse().map(normalize);
  }
  const params = [];
  let where = '';
  if (lane) { params.push(lane); where = 'WHERE lane = $1'; }
  params.push(Math.min(Number(limit) || 200, 1000));
  const { rows } = await query(
    `SELECT * FROM research_notes ${where} ORDER BY recorded_at DESC LIMIT $${params.length}`, params);
  return rows.map(normalize);
}

/**
 * The git-side mirror. Postgres holds the live rows; a database can be lost and
 * a repository usually is not, so the evidence is written where git keeps it.
 */
export function renderResearchMirror(notes = []) {
  const lines = [
    '# Research notes',
    '',
    'Generated from the `research_notes` store by `npm run research -- export`.',
    'Postgres holds the live rows; this file is what survives losing it.',
    ''
  ];
  for (const n of notes) {
    lines.push(`## ${n.claim}`, '');
    lines.push(`- **Tier:** ${n.tier}`);
    lines.push(`- **Source:** ${n.source || '_none — this is a hypothesis, not a finding_'}`);
    if (n.lane) lines.push(`- **Lane:** ${n.lane}`);
    lines.push(`- **Recorded:** ${n.recordedAt}`, '');
  }
  return lines.join('\n');
}

export async function resetResearchLogForTesting() {
  mem.notes.length = 0;
  await truncateForTesting(['research_notes']);
}
