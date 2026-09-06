import { databaseEnabled, query, truncateForTesting } from '@taskman/db';
import { triageBountyListing, TRIAGE_VERDICT } from './triage.js';

const memoryTriageStore = new Map(); // id -> record

function normalizeTriageRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    listingKey: row.listingKey ?? row.listing_key,
    repo: row.repo,
    issueNumber: row.issueNumber ?? row.issue_number,
    title: row.title,
    verdict: row.verdict,
    failedGate: row.failedGate ?? row.failed_gate ?? null,
    reason: row.reason,
    evidence: row.evidence || {},
    triagedAt: row.triagedAt ?? row.triaged_at
  };
}

/**
 * Runs triage on a listing, records the result, and returns the verdict.
 */
export async function triageAndRecordBounty(listing, options = {}) {
  const verdict = triageBountyListing(listing, options);

  const id = `triage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const listingKey = listing.url || `${listing.repo}#${listing.issueNumber}` || id;

  const record = {
    id,
    listingKey,
    repo: listing.repo || 'unknown',
    issueNumber: listing.issueNumber != null ? Number(listing.issueNumber) : null,
    title: listing.title || 'Untitled listing',
    verdict: verdict.verdict,
    failedGate: verdict.failedGate,
    reason: verdict.reason,
    evidence: verdict.evidence,
    triagedAt: new Date().toISOString()
  };

  if (!databaseEnabled) {
    memoryTriageStore.set(id, record);
    return { ...record, ...verdict };
  }

  const res = await query(`
    INSERT INTO bounty_triage_records (
      id, listing_key, repo, issue_number, title, verdict, failed_gate, reason, evidence, triaged_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
    RETURNING *
  `, [
    record.id,
    record.listingKey,
    record.repo,
    record.issueNumber,
    record.title,
    record.verdict,
    record.failedGate,
    record.reason,
    JSON.stringify(record.evidence)
  ]);

  return { ...normalizeTriageRow(res.rows[0]), ...verdict };
}

/**
 * Lists recorded triage decisions.
 */
export async function listTriageRecords({ verdict = null, repo = null, limit = 100 } = {}) {
  if (!databaseEnabled) {
    let list = Array.from(memoryTriageStore.values());
    if (verdict) list = list.filter(r => r.verdict === verdict);
    if (repo) list = list.filter(r => r.repo === repo);
    return list.sort((a, b) => new Date(b.triagedAt) - new Date(a.triagedAt)).slice(0, limit);
  }

  const conditions = [];
  const params = [];
  if (verdict) {
    params.push(verdict);
    conditions.push(`verdict = $${params.length}`);
  }
  if (repo) {
    params.push(repo);
    conditions.push(`repo = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const sql = `SELECT * FROM bounty_triage_records ${where} ORDER BY triaged_at DESC LIMIT $${params.length}`;

  const res = await query(sql, params);
  return res.rows.map(normalizeTriageRow);
}

/**
 * Generates an empirical yield report comparing raw listings seen vs viable tasks.
 */
export async function getBountyYieldReport() {
  const records = await listTriageRecords({ limit: 5000 });
  const total = records.length;
  const viable = records.filter(r => r.verdict === TRIAGE_VERDICT.VIABLE).length;
  const rejected = total - viable;

  const rejectionsByGate = {};
  for (const r of records) {
    if (r.failedGate) {
      rejectionsByGate[r.failedGate] = (rejectionsByGate[r.failedGate] || 0) + 1;
    }
  }

  const yieldPct = total > 0 ? Number(((viable / total) * 100).toFixed(2)) : 0;

  return {
    totalListings: total,
    viableCount: viable,
    rejectedCount: rejected,
    yieldPercentage: yieldPct,
    baseRateBenchmark: 'Expected viable rate in agent bounty market is 1-2% (232 listings -> ~2-5 doable)',
    rejectionsByGate,
    generatedAt: new Date().toISOString()
  };
}

export async function resetTriageMemory() {
  memoryTriageStore.clear();
  await truncateForTesting(['bounty_triage_records']);
}
