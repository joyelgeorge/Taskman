import { databaseEnabled, query, withTransaction, truncateForTesting } from './db.js';

const memoryStore = new Map(); // repo -> Map(issueNumber -> item)

export const WORK_ELIGIBILITY = Object.freeze({
  READY: 'READY',
  NEEDS_PR_FIX: 'NEEDS_PR_FIX',
  BLOCKED: 'BLOCKED',
  IN_FLIGHT_PR: 'IN_FLIGHT_PR',
  CLOSED: 'CLOSED'
});

export const PRIORITY_WEIGHTS = Object.freeze({
  P0: 1000,
  P1: 500,
  P2: 200,
  P3: 100,
  DEFAULT: 100
});

/**
 * Extracts dependency issue numbers from markdown issue bodies.
 * Supports:
 * - "Depends on #12, #13" / "Blocked by #14" / "Requires #15"
 * - "- #12" under dependencies headers
 */
export function parseIssueDependencies(body) {
  if (!body || typeof body !== 'string') return [];
  const dependencies = new Set();

  // Pattern 1: keyword followed by issue refs, e.g. "Depends on #12", "blocked by #15, #16", "Refs #83"
  const keywordRegex = /(?:depends\s+on|blocked\s+by|requires|blockers?|dependencies|refs?)[:\s]+((?:#?\d+[\s,and&]*)+)/gi;
  let match;
  while ((match = keywordRegex.exec(body)) !== null) {
    const refsText = match[1];
    const numberMatches = refsText.match(/\d+/g);
    if (numberMatches) {
      for (const numStr of numberMatches) {
        const num = parseInt(numStr, 10);
        if (num > 0) dependencies.add(num);
      }
    }
  }

  // Pattern 2: bullet lists under a Dependencies or Blockers heading
  const sectionRegex = /(?:##\s*(?:Dependencies|Blockers|Related\s*work)[\s\S]*?)(?=(?:##|\n\n\n|$))/gi;
  while ((match = sectionRegex.exec(body)) !== null) {
    const sectionText = match[0];
    const bulletMatches = sectionText.match(/[-*]\s*#?(\d+)/g);
    if (bulletMatches) {
      for (const item of bulletMatches) {
        const numStr = item.match(/\d+/);
        if (numStr) {
          const num = parseInt(numStr[0], 10);
          if (num > 0) dependencies.add(num);
        }
      }
    }
  }

  return Array.from(dependencies).sort((a, b) => a - b);
}

/**
 * Extracts issue numbers that a PR intends to close or is associated with.
 */
export function extractPrIssueLinks(pr) {
  const linked = new Set();
  if (!pr) return [];

  // Check branch name e.g. feat/issue-83-usage-metering, fix/issue-121
  const branch = pr.head?.ref || pr.headRefName || '';
  const branchMatch = branch.match(/(?:issue|fix|feat)[/-](\d+)/i);
  if (branchMatch) linked.add(parseInt(branchMatch[1], 10));

  // Check PR title e.g. "Add authoritative usage metering (#83)"
  const title = pr.title || '';
  const titleMatches = title.match(/#(\d+)/g);
  if (titleMatches) {
    for (const m of titleMatches) linked.add(parseInt(m.slice(1), 10));
  }

  // Check PR body for closing keywords: Closes #83, Fixes #83, Resolves #83
  const body = pr.body || '';
  const closeRegex = /(?:closes|fixes|resolves|closing|closed|fixed|resolved)\s+#?(\d+)/gi;
  let match;
  while ((match = closeRegex.exec(body)) !== null) {
    linked.add(parseInt(match[1], 10));
  }

  return Array.from(linked).sort((a, b) => a - b);
}

/**
 * Resolves base priority from labels and title.
 */
export function calculateBasePriority(issue) {
  const labels = (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name || '').toLowerCase());
  const title = (issue.title || '').trim();

  if (labels.some(l => l.includes('p0') || l.includes('high-priority') || l.includes('critical')) || /^p0\b/i.test(title)) {
    return PRIORITY_WEIGHTS.P0;
  }
  if (labels.some(l => l.includes('p1')) || /^p1\b/i.test(title)) {
    return PRIORITY_WEIGHTS.P1;
  }
  if (labels.some(l => l.includes('p2')) || /^p2\b/i.test(title)) {
    return PRIORITY_WEIGHTS.P2;
  }
  if (labels.some(l => l.includes('p3')) || /^p3\b/i.test(title)) {
    return PRIORITY_WEIGHTS.P3;
  }
  return PRIORITY_WEIGHTS.DEFAULT;
}

/**
 * Normalizes and ranks a collection of raw GitHub issues and PRs.
 * Implements blocker priority inheritance and in-flight PR duplicate suppression.
 */
export function normalizeAndRankWorkItems({ repo = 'local/repo', rawIssues = [], rawPullRequests = [] }) {
  // 1. Map open PRs and their linked issues
  const prsByIssue = new Map();
  for (const pr of rawPullRequests) {
    const linkedIssues = extractPrIssueLinks(pr);
    const prSummary = {
      number: pr.number,
      title: pr.title,
      headBranch: pr.head?.ref || pr.headRefName || '',
      state: pr.state || 'open',
      draft: Boolean(pr.draft),
      reviewDecision: pr.reviewDecision || null, // e.g. 'CHANGES_REQUESTED', 'APPROVED'
      ciStatus: pr.ciStatus || null // e.g. 'failure', 'success'
    };
    for (const issueNum of linkedIssues) {
      if (!prsByIssue.has(issueNum)) prsByIssue.set(issueNum, []);
      prsByIssue.get(issueNum).push(prSummary);
    }
  }

  // 2. Separate open vs closed issues
  const closedIssueNumbers = new Set();
  const openIssues = [];

  for (const item of rawIssues) {
    // If it's a pull request returned in the issues API, skip (handled via pulls)
    if (item.pull_request) continue;
    if (item.state === 'closed') {
      closedIssueNumbers.add(item.number);
    } else {
      openIssues.push(item);
    }
  }

  // 3. First pass: build base work items
  const workItems = new Map();
  for (const issue of openIssues) {
    const num = issue.number;
    const dependencies = parseIssueDependencies(issue.body || '').filter(d => d !== num);
    const basePriority = calculateBasePriority(issue);
    const activePrs = prsByIssue.get(num) || [];

    workItems.set(num, {
      id: `${repo}#${num}`,
      repo,
      issueNumber: num,
      title: issue.title,
      state: 'open',
      labels: (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name || '')),
      basePriority,
      effectivePriority: basePriority,
      blockerIssueNumbers: dependencies,
      blockingIssueNumbers: [],
      activePr: activePrs[0] || null,
      activePrs,
      eligibilityStatus: WORK_ELIGIBILITY.READY,
      eligibilityReason: 'Ready for implementation',
      rawPayload: {
        url: issue.html_url,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at
      },
      githubUpdatedAt: issue.updated_at || new Date().toISOString()
    });
  }

  // 4. Second pass: build reverse blocker map and elevate blocker priorities
  for (const [num, item] of workItems) {
    for (const depNum of item.blockerIssueNumbers) {
      const depItem = workItems.get(depNum);
      if (depItem) {
        depItem.blockingIssueNumbers.push(num);
      }
    }
  }

  // Elevate blocker priorities (Requirement: blocker of P0 outranks or equals the P0 item)
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 10) {
    changed = false;
    iterations++;
    for (const [num, item] of workItems) {
      for (const blockedNum of item.blockingIssueNumbers) {
        const blockedItem = workItems.get(blockedNum);
        if (blockedItem && blockedItem.effectivePriority > item.effectivePriority) {
          item.effectivePriority = blockedItem.effectivePriority;
          changed = true;
        }
      }
    }
  }

  // 5. Third pass: determine final eligibility status and reason
  for (const [num, item] of workItems) {
    // Check blockers: any dependency not in closedIssueNumbers
    const unresolvedBlockers = item.blockerIssueNumbers.filter(d => !closedIssueNumbers.has(d));
    if (unresolvedBlockers.length > 0) {
      item.eligibilityStatus = WORK_ELIGIBILITY.BLOCKED;
      item.eligibilityReason = `Blocked by open issue(s): #${unresolvedBlockers.join(', #')}`;
      continue;
    }

    // Check active PRs
    if (item.activePr) {
      const pr = item.activePr;
      if (pr.reviewDecision === 'CHANGES_REQUESTED' || pr.ciStatus === 'failure') {
        item.eligibilityStatus = WORK_ELIGIBILITY.NEEDS_PR_FIX;
        item.eligibilityReason = `Active PR #${pr.number} requires fixes (${pr.reviewDecision || pr.ciStatus})`;
      } else {
        item.eligibilityStatus = WORK_ELIGIBILITY.IN_FLIGHT_PR;
        item.eligibilityReason = `Covered by active PR #${pr.number} on branch ${pr.headBranch}`;
      }
      continue;
    }

    item.eligibilityStatus = WORK_ELIGIBILITY.READY;
    item.eligibilityReason = 'Dependencies satisfied; ready for dispatch';
  }

  // 6. Sort items according to deterministic ranking policy:
  // - Priority order of status: READY & NEEDS_PR_FIX > BLOCKED > IN_FLIGHT_PR > CLOSED
  // - Then effective priority (DESC)
  // - Then issue number (ASC FIFO tie-breaker)
  const statusWeight = status => {
    switch (status) {
      case WORK_ELIGIBILITY.READY: return 4;
      case WORK_ELIGIBILITY.NEEDS_PR_FIX: return 3;
      case WORK_ELIGIBILITY.BLOCKED: return 2;
      case WORK_ELIGIBILITY.IN_FLIGHT_PR: return 1;
      default: return 0;
    }
  };

  const ranked = Array.from(workItems.values()).sort((a, b) => {
    const swA = statusWeight(a.eligibilityStatus);
    const swB = statusWeight(b.eligibilityStatus);
    if (swA !== swB) return swB - swA;

    if (b.effectivePriority !== a.effectivePriority) {
      return b.effectivePriority - a.effectivePriority;
    }
    return a.issueNumber - b.issueNumber;
  });

  return ranked;
}

/**
 * Fetches all issues (open and closed) across pagination via GitHub API.
 */
export async function fetchAllGitHubIssues({ repo, token, fetchImpl = globalThis.fetch, perPage = 100 }) {
  const allIssues = [];
  let page = 1;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Taskman-GitHub-Intake'
  };
  if (token) headers['Authorization'] = `token ${token}`;

  while (page <= 20) { // Safety ceiling: up to 2000 issues
    const url = `https://api.github.com/repos/${repo}/issues?state=all&per_page=${perPage}&page=${page}`;
    const res = await fetchImpl(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub issues fetch failed with status ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    allIssues.push(...data);
    if (data.length < perPage) break;
    page++;
  }
  return allIssues;
}

/**
 * Fetches all open pull requests across pagination via GitHub API.
 */
export async function fetchAllGitHubPullRequests({ repo, token, fetchImpl = globalThis.fetch, perPage = 100 }) {
  const allPrs = [];
  let page = 1;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Taskman-GitHub-Intake'
  };
  if (token) headers['Authorization'] = `token ${token}`;

  while (page <= 10) { // Safety ceiling: up to 1000 PRs
    const url = `https://api.github.com/repos/${repo}/pulls?state=open&per_page=${perPage}&page=${page}`;
    const res = await fetchImpl(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub PRs fetch failed with status ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    allPrs.push(...data);
    if (data.length < perPage) break;
    page++;
  }
  return allPrs;
}

/**
 * Persists normalized work items to PostgreSQL or in-memory store.
 */
export async function persistWorkItems(items, repo) {
  if (!databaseEnabled) {
    let repoMap = memoryStore.get(repo);
    if (!repoMap) {
      repoMap = new Map();
      memoryStore.set(repo, repoMap);
    }
    for (const item of items) {
      repoMap.set(item.issueNumber, { ...item, syncedAt: new Date().toISOString() });
    }
    return items;
  }

  for (const item of items) {
    await query(`
      INSERT INTO github_work_items (
        id, repo, issue_number, title, state, labels, base_priority, effective_priority,
        blocker_issue_numbers, blocking_issue_numbers, active_pr, eligibility_status,
        eligibility_reason, raw_payload, github_updated_at, synced_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14::jsonb, $15, now())
      ON CONFLICT (repo, issue_number)
      DO UPDATE SET
        title = EXCLUDED.title,
        state = EXCLUDED.state,
        labels = EXCLUDED.labels,
        base_priority = EXCLUDED.base_priority,
        effective_priority = EXCLUDED.effective_priority,
        blocker_issue_numbers = EXCLUDED.blocker_issue_numbers,
        blocking_issue_numbers = EXCLUDED.blocking_issue_numbers,
        active_pr = EXCLUDED.active_pr,
        eligibility_status = EXCLUDED.eligibility_status,
        eligibility_reason = EXCLUDED.eligibility_reason,
        raw_payload = EXCLUDED.raw_payload,
        github_updated_at = EXCLUDED.github_updated_at,
        synced_at = now()
    `, [
      item.id,
      item.repo,
      item.issueNumber,
      item.title,
      item.state,
      JSON.stringify(item.labels),
      item.basePriority,
      item.effectivePriority,
      JSON.stringify(item.blockerIssueNumbers),
      JSON.stringify(item.blockingIssueNumbers),
      item.activePr ? JSON.stringify(item.activePr) : null,
      item.eligibilityStatus,
      item.eligibilityReason,
      JSON.stringify(item.rawPayload),
      // github_updated_at is NOT NULL. The intake path already defaults this,
      // but a direct persistWorkItems() call did not, which wrote NULL and
      // failed the insert; default at the store boundary so both paths agree.
      item.githubUpdatedAt || new Date().toISOString()
    ]);
  }
  return items;
}

/**
 * Retrieves the ranked actionable work queue from memory or PostgreSQL.
 */
export async function getActionableWorkQueue({ repo = 'joyelgeorge/Taskman', eligibilityStatus } = {}) {
  if (!databaseEnabled) {
    const repoMap = memoryStore.get(repo);
    if (!repoMap) return [];
    let list = Array.from(repoMap.values());
    if (eligibilityStatus) {
      list = list.filter(item => item.eligibilityStatus === eligibilityStatus);
    }
    return list.sort((a, b) => {
      if (b.effectivePriority !== a.effectivePriority) return b.effectivePriority - a.effectivePriority;
      return a.issueNumber - b.issueNumber;
    });
  }

  let sql = 'SELECT * FROM github_work_items WHERE repo = $1';
  const params = [repo];
  if (eligibilityStatus) {
    sql += ' AND eligibility_status = $2';
    params.push(eligibilityStatus);
  }
  sql += ' ORDER BY effective_priority DESC, issue_number ASC';

  const result = await query(sql, params);
  return result.rows.map(row => ({
    id: row.id,
    repo: row.repo,
    issueNumber: row.issue_number,
    title: row.title,
    state: row.state,
    labels: row.labels,
    basePriority: row.base_priority,
    effectivePriority: row.effective_priority,
    blockerIssueNumbers: row.blocker_issue_numbers,
    blockingIssueNumbers: row.blocking_issue_numbers,
    activePr: row.active_pr,
    eligibilityStatus: row.eligibility_status,
    eligibilityReason: row.eligibility_reason,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    leaseExpiresAt: row.lease_expires_at,
    githubUpdatedAt: row.github_updated_at,
    syncedAt: row.synced_at
  }));
}

/**
 * Primary synchronization method: queries GitHub, ranks work, persists cache, and returns summary.
 */
export async function syncGitHubWork({
  repo = process.env.TASKMAN_REPO || 'joyelgeorge/Taskman',
  token = process.env.GITHUB_TOKEN,
  fetchImpl = globalThis.fetch,
  persist = true
} = {}) {
  const [rawIssues, rawPullRequests] = await Promise.all([
    fetchAllGitHubIssues({ repo, token, fetchImpl }),
    fetchAllGitHubPullRequests({ repo, token, fetchImpl })
  ]);

  const rankedItems = normalizeAndRankWorkItems({ repo, rawIssues, rawPullRequests });

  if (persist) {
    await persistWorkItems(rankedItems, repo);
  }

  const readyItems = rankedItems.filter(i => i.eligibilityStatus === WORK_ELIGIBILITY.READY || i.eligibilityStatus === WORK_ELIGIBILITY.NEEDS_PR_FIX);
  const blockedItems = rankedItems.filter(i => i.eligibilityStatus === WORK_ELIGIBILITY.BLOCKED);
  const inFlightItems = rankedItems.filter(i => i.eligibilityStatus === WORK_ELIGIBILITY.IN_FLIGHT_PR);

  return {
    ok: true,
    repo,
    syncedAt: new Date().toISOString(),
    total: rankedItems.length,
    readyCount: readyItems.length,
    blockedCount: blockedItems.length,
    inFlightCount: inFlightItems.length,
    topEligible: readyItems[0] || null,
    items: rankedItems
  };
}

/**
 * Atomically claims the highest priority eligible work item from the queue with a lease.
 */
export async function claimActionableWorkItem({
  repo = 'joyelgeorge/Taskman',
  claimedBy = 'taskman-execute-worker',
  leaseDurationMs = 15 * 60 * 1000,
  now = new Date()
} = {}) {
  const currentTime = new Date(now);
  const leaseExpiresAt = new Date(currentTime.getTime() + leaseDurationMs);

  if (!databaseEnabled) {
    const repoMap = memoryStore.get(repo);
    if (!repoMap) return null;
    const candidates = Array.from(repoMap.values())
      .filter(item => (item.eligibilityStatus === WORK_ELIGIBILITY.READY || item.eligibilityStatus === WORK_ELIGIBILITY.NEEDS_PR_FIX))
      .filter(item => !item.leaseExpiresAt || new Date(item.leaseExpiresAt).getTime() <= currentTime.getTime())
      .sort((a, b) => {
        if (b.effectivePriority !== a.effectivePriority) return b.effectivePriority - a.effectivePriority;
        return a.issueNumber - b.issueNumber;
      });

    if (candidates.length === 0) return null;
    const item = candidates[0];
    item.claimedBy = claimedBy;
    item.claimedAt = currentTime.toISOString();
    item.leaseExpiresAt = leaseExpiresAt.toISOString();
    return { ...item };
  }

  return withTransaction(async client => {
    const selectSql = `
      SELECT * FROM github_work_items
      WHERE repo = $1
        AND eligibility_status IN ('READY', 'NEEDS_PR_FIX')
        AND (lease_expires_at IS NULL OR lease_expires_at <= $2)
      ORDER BY effective_priority DESC, issue_number ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const res = await client.query(selectSql, [repo, currentTime.toISOString()]);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    const updateSql = `
      UPDATE github_work_items
      SET claimed_by = $1,
          claimed_at = $2,
          lease_expires_at = $3,
          synced_at = now()
      WHERE id = $4
      RETURNING *
    `;
    const updateRes = await client.query(updateSql, [
      claimedBy,
      currentTime.toISOString(),
      leaseExpiresAt.toISOString(),
      row.id
    ]);

    const updated = updateRes.rows[0];
    return {
      id: updated.id,
      repo: updated.repo,
      issueNumber: updated.issue_number,
      title: updated.title,
      state: updated.state,
      labels: updated.labels,
      basePriority: updated.base_priority,
      effectivePriority: updated.effective_priority,
      blockerIssueNumbers: updated.blocker_issue_numbers,
      blockingIssueNumbers: updated.blocking_issue_numbers,
      activePr: updated.active_pr,
      eligibilityStatus: updated.eligibility_status,
      eligibilityReason: updated.eligibility_reason,
      claimedBy: updated.claimed_by,
      claimedAt: updated.claimed_at,
      leaseExpiresAt: updated.lease_expires_at,
      githubUpdatedAt: updated.github_updated_at,
      syncedAt: updated.synced_at
    };
  });
}

/**
 * Releases or updates a claimed work item after execution.
 */
export async function releaseActionableWorkItem({
  repo = 'joyelgeorge/Taskman',
  issueNumber,
  claimedBy,
  eligibilityStatus,
  eligibilityReason,
  activePr = null
} = {}) {
  if (!databaseEnabled) {
    const repoMap = memoryStore.get(repo);
    if (!repoMap) return null;
    const item = repoMap.get(issueNumber);
    if (!item) return null;
    item.claimedBy = null;
    item.claimedAt = null;
    item.leaseExpiresAt = null;
    if (eligibilityStatus) item.eligibilityStatus = eligibilityStatus;
    if (eligibilityReason) item.eligibilityReason = eligibilityReason;
    if (activePr) item.activePr = activePr;
    return { ...item };
  }

  let updateSql = `
    UPDATE github_work_items
    SET claimed_by = NULL,
        claimed_at = NULL,
        lease_expires_at = NULL,
        synced_at = now()
  `;
  const params = [repo, issueNumber];
  let paramIdx = 3;

  if (eligibilityStatus) {
    updateSql += `, eligibility_status = $${paramIdx++}`;
    params.push(eligibilityStatus);
  }
  if (eligibilityReason) {
    updateSql += `, eligibility_reason = $${paramIdx++}`;
    params.push(eligibilityReason);
  }
  if (activePr) {
    updateSql += `, active_pr = $${paramIdx++}::jsonb`;
    params.push(JSON.stringify(activePr));
  }

  updateSql += ` WHERE repo = $1 AND issue_number = $2 RETURNING *`;
  const result = await query(updateSql, params);
  return result.rows[0] || null;
}

export async function resetIntakeMemory() {
  memoryStore.clear();
  await truncateForTesting(['repo_execution_runs', 'github_work_items']);
}

