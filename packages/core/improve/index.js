import { databaseEnabled, query } from '@taskman/db';
import { MemoryTable, nowIso } from '../memory-table.js';
import { listDrones, droneRunHistory } from '../drones/store.js';
import { cronStatuses } from '../observability/cron-store.js';
import { listAlerts } from '../observability/alerts.js';
import { signalStats } from '../signals/store.js';

const mem = { improvements: new MemoryTable() };

const normalize = (row = {}) => ({
  id: row.id,
  fingerprint: row.fingerprint,
  source: row.source,
  title: row.title,
  rationale: row.rationale,
  proposedChange: row.proposedChange ?? row.proposed_change,
  expectedImpact: row.expectedImpact ?? row.expected_impact ?? null,
  evidence: row.evidence || {},
  score: Number(row.score || 0),
  status: row.status || 'PROPOSED',
  createdAt: row.createdAt ?? row.created_at ?? null,
  decidedAt: row.decidedAt ?? row.decided_at ?? null
});

export async function proposeImprovement(proposal) {
  const row = normalize({ ...proposal, id: crypto.randomUUID(), createdAt: nowIso() });
  if (!row.fingerprint || !row.title || !row.proposedChange) {
    throw new Error('fingerprint, title and proposedChange are required');
  }

  if (!databaseEnabled) {
    const open = mem.improvements.find(i => i.fingerprint === row.fingerprint && i.status === 'PROPOSED');
    if (open) return { improvement: open, created: false };
    mem.improvements.insert(row);
    return { improvement: row, created: true };
  }

  const result = await query(`
    INSERT INTO improvements(fingerprint, source, title, rationale, proposed_change, expected_impact, evidence, score)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
    ON CONFLICT (fingerprint) WHERE status = 'PROPOSED' DO NOTHING
    RETURNING *
  `, [row.fingerprint, row.source, row.title, row.rationale, row.proposedChange,
      row.expectedImpact, JSON.stringify(row.evidence), row.score]);

  if (result.rowCount) return { improvement: normalize(result.rows[0]), created: true };
  const existing = await query(`SELECT * FROM improvements WHERE fingerprint=$1 AND status='PROPOSED'`, [row.fingerprint]);
  return { improvement: existing.rows[0] ? normalize(existing.rows[0]) : null, created: false };
}

export async function listImprovements({ status = 'PROPOSED', limit = 100 } = {}) {
  if (!databaseEnabled) {
    return mem.improvements.filter(i => !status || i.status === status)
      .sort((a, b) => b.score - a.score).slice(0, limit);
  }
  const params = [];
  let where = '';
  if (status) { params.push(status); where = 'WHERE status = $1'; }
  params.push(limit);
  const result = await query(`SELECT * FROM improvements ${where} ORDER BY score DESC, created_at DESC LIMIT $${params.length}`, params);
  return result.rows.map(normalize);
}

export async function decideImprovement(id, status) {
  if (!['ACCEPTED', 'REJECTED', 'APPLIED'].includes(status)) throw new Error(`invalid decision: ${status}`);
  if (!databaseEnabled) {
    const improvement = mem.improvements.find(i => i.id === id);
    if (!improvement) return null;
    Object.assign(improvement, { status, decidedAt: nowIso() });
    return improvement;
  }
  const result = await query(
    `UPDATE improvements SET status=$2, decided_at=now() WHERE id=$1 RETURNING *`, [id, status]
  );
  return result.rows[0] ? normalize(result.rows[0]) : null;
}

/**
 * Derives improvement proposals from what the system has observed about itself.
 *
 * Deterministic: every proposal traces to a row somebody can go and look at. The
 * output is inert — a PROPOSED record and nothing else. Applying a change stays a
 * human decision, because a system that edits itself on its own evidence is the
 * failure this project already has one example of.
 */
export async function researchImprovements({ railEconomics = async () => [], now = new Date() } = {}) {
  const proposals = [];

  const economics = await railEconomics();
  if (!economics.length) {
    proposals.push({
      source: 'revenue_gap', fingerprint: 'no-rails-registered', score: 1.0,
      title: 'No revenue rail is registered',
      rationale: 'The ledger has no rail rows, so no attempt at money has ever been made and no reward signal can exist.',
      proposedChange: 'Register one rail with a declared settlement source and a $50 probation budget.',
      expectedImpact: 'Creates the first non-zero reward signal, or a recorded reason within 25 attempts.',
      evidence: { railCount: 0 }
    });
  }

  for (const rail of economics) {
    if (rail.clearedCents === 0 && rail.attempts >= 10) {
      proposals.push({
        source: 'revenue_gap', fingerprint: `rail-unproductive-${rail.rail}`, score: 0.9,
        title: `Rail "${rail.rail}" has ${rail.attempts} attempts and no settlement`,
        rationale: `Spent ${(rail.spendCents / 100).toFixed(2)} with zero cleared settlements. The governor will disable it, but the cause is worth recording before it does.`,
        proposedChange: 'Inspect the rail’s failed attempts for a common blocker, or let the probation budget expire and replace the rail.',
        expectedImpact: 'Either removes a blocker or ends spend on a venue that does not settle.',
        evidence: rail
      });
    }
    if (rail.roi != null && rail.roi >= 3 && rail.clearedCount >= 5) {
      proposals.push({
        source: 'revenue_gap', fingerprint: `rail-scale-${rail.rail}`, score: 0.95,
        title: `Rail "${rail.rail}" is returning ${rail.roi}x — consider scaling`,
        rationale: `${rail.clearedCount} cleared settlements at ROI ${rail.roi}. Attention is currently capped by the probation budget.`,
        proposedChange: 'Promote the rail to SCALED and raise its budget within the global cap.',
        expectedImpact: 'Increases spend on the only rail with proven return.',
        evidence: rail
      });
    }
  }

  for (const drone of await listDrones()) {
    const history = await droneRunHistory(drone.id, 10);
    const completed = history.filter(r => r.status === 'OK' || r.status === 'FAILED');
    const yieldSum = completed.reduce((sum, r) => sum + Number(r.signals_new ?? r.signalsNew ?? 0), 0);

    if (completed.length >= 5 && yieldSum === 0) {
      proposals.push({
        source: 'drone_yield', fingerprint: `drone-barren-${drone.id}`, score: 0.6,
        title: `Drone "${drone.id}" has produced no new signals in ${completed.length} runs`,
        rationale: 'The source is reachable but nothing new arrives, so every run costs a request and returns nothing.',
        proposedChange: 'Widen the drone’s extraction config, lengthen its interval, or retire it.',
        expectedImpact: 'Removes wasted requests, or restores a source that has silently changed shape.',
        evidence: { runs: completed.length, newSignals: 0, targetUrl: drone.targetUrl }
      });
    }

    if (drone.quarantinedUntil && new Date(drone.quarantinedUntil) > now) {
      proposals.push({
        source: 'health', fingerprint: `drone-quarantined-${drone.id}`, score: 0.7,
        title: `Drone "${drone.id}" is quarantined after repeated failures`,
        rationale: `Last error: ${drone.lastError || 'unknown'}`,
        proposedChange: 'Check whether the target URL or response shape changed, then re-enable the drone.',
        expectedImpact: 'Restores a collection source that is currently contributing nothing.',
        evidence: { lastError: drone.lastError, quarantinedUntil: drone.quarantinedUntil }
      });
    }
  }

  for (const cron of await cronStatuses({ now })) {
    if (['OVERDUE', 'STUCK'].includes(cron.status)) {
      proposals.push({
        source: 'cron_failure', fingerprint: `cron-silent-${cron.cronName}`, score: 0.85,
        title: `Cron "${cron.cronName}" is ${cron.status.toLowerCase()}`,
        rationale: `Expected every ${cron.maxSilenceSeconds}s; last run ${cron.silentSeconds == null ? 'never' : `${cron.silentSeconds}s ago`}. A cron that stops being scheduled reports no error.`,
        proposedChange: 'Verify the schedule is still registered with the runner and that credentials have not expired.',
        expectedImpact: 'Restores a stage of the pipeline that is currently not running at all.',
        evidence: cron
      });
    }
  }

  const stats = await signalStats();
  if (stats.byStatus?.QUARANTINED > 0) {
    proposals.push({
      source: 'research', fingerprint: 'signals-quarantined', score: 0.5,
      title: `${stats.byStatus.QUARANTINED} signal(s) quarantined for injection patterns`,
      rationale: 'A source is serving text aimed at an agent rather than at a reader.',
      proposedChange: 'Review the quarantined signals and, if the source is persistently hostile, disable that drone.',
      expectedImpact: 'Removes an active prompt-injection surface.',
      evidence: stats
    });
  }

  const created = [];
  for (const proposal of proposals) {
    const result = await proposeImprovement(proposal);
    if (result.created) created.push(result.improvement);
  }

  return {
    evaluated: proposals.length,
    createdCount: created.length,
    duplicateCount: proposals.length - created.length,
    created,
    openAlerts: (await listAlerts({ open: true })).length
  };
}

export function resetImprovementMemory() { mem.improvements.clear(); }
