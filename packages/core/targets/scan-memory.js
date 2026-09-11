import { databaseEnabled, query } from '@taskman/db';
import { MemoryTable, nowIso } from '../memory-table.js';

/**
 * What the vibe-coded-app sweep has already looked at.
 *
 * The sweep regenerates its candidate list from GitHub search every run. Without
 * a memory it re-cloned and re-scanned the same top-starred repos each Monday,
 * spending the entire budget rediscovering last week's findings while the pool
 * of repos ever examined never grew. This is that memory.
 *
 * A clean result is not permanent - code changes - so a repo becomes eligible
 * again once the window passes. Errors are retried sooner, because an error is
 * usually a timeout or a rate limit rather than a verdict.
 *
 * No finding detail is stored here. Classes and counts live on the lead record;
 * a file path or an excerpt is never persisted anywhere.
 */

export const SCAN_OUTCOME = Object.freeze({
  LEAD: 'LEAD',
  CLEAN: 'CLEAN',
  VULN_NOT_BUSINESS: 'VULN_NOT_BUSINESS',
  ERROR: 'ERROR'
});

const mem = { repos: new MemoryTable({ unique: ['repo'] }) };

const DAY_MS = 86_400_000;

export async function recordScanned({ repo, outcome, findingCount = 0, now = nowIso } = {}) {
  if (!repo) throw new Error('repo is required');
  if (!Object.values(SCAN_OUTCOME).includes(outcome)) {
    throw new Error(`invalid outcome "${outcome}" — must be one of ${Object.values(SCAN_OUTCOME).join(', ')}`);
  }
  const scannedAt = typeof now === 'function' ? now() : nowIso();

  if (!databaseEnabled) {
    const existing = mem.repos.find(r => r.repo === repo);
    if (existing) {
      Object.assign(existing, {
        outcome, findingCount, scannedAt, scanCount: (existing.scanCount || 1) + 1
      });
      return { ...existing };
    }
    const row = { repo, outcome, findingCount, scannedAt, scanCount: 1 };
    mem.repos.insert(row);
    return { ...row };
  }

  const { rows } = await query(`
    INSERT INTO scanned_repos (repo, scanned_at, outcome, finding_count, scan_count)
    VALUES ($1, $2, $3, $4, 1)
    ON CONFLICT (repo) DO UPDATE SET
      scanned_at = EXCLUDED.scanned_at,
      outcome = EXCLUDED.outcome,
      finding_count = EXCLUDED.finding_count,
      scan_count = scanned_repos.scan_count + 1
    RETURNING *
  `, [repo, scannedAt, outcome, findingCount]);
  return normalize(rows[0]);
}

const normalize = (row) => row && ({
  repo: row.repo,
  outcome: row.outcome,
  findingCount: row.finding_count ?? row.findingCount ?? 0,
  scannedAt: row.scanned_at ?? row.scannedAt,
  scanCount: row.scan_count ?? row.scanCount ?? 1
});

export async function listScanned() {
  if (!databaseEnabled) return mem.repos.all().map(r => ({ ...r }));
  const { rows } = await query('SELECT * FROM scanned_repos ORDER BY scanned_at DESC');
  return rows.map(normalize);
}

/**
 * Narrow a candidate list to what is worth spending a clone on, preserving the
 * order the candidates arrived in so the search's own ranking survives.
 */
export async function selectUnscanned(candidates = [], {
  withinDays = 30, retryErrorsAfterDays = 1, now = Date.now
} = {}) {
  if (!candidates.length) return [];
  const seen = await listScanned();
  const byRepo = new Map(seen.map(r => [r.repo, r]));
  const at = typeof now === 'function' ? now() : Date.now();

  return candidates.filter(repo => {
    const previous = byRepo.get(repo);
    if (!previous) return true;
    const ageDays = (at - Date.parse(previous.scannedAt)) / DAY_MS;
    const window = previous.outcome === SCAN_OUTCOME.ERROR ? retryErrorsAfterDays : withinDays;
    return ageDays >= window;
  });
}

export function resetScanMemoryForTesting() {
  mem.repos.clear();
}
