import { databaseEnabled, query, truncateForTesting } from '@taskman/db';

const memoryCandidateStore = new Map(); // id -> candidate

export const CANDIDATE_STATUS = Object.freeze({
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  DISCARDED: 'DISCARDED',
  REFUSED_POLICY_BAN: 'REFUSED_POLICY_BAN',
  SUBMITTED_BY_HUMAN: 'SUBMITTED_BY_HUMAN'
});

const VALID_STATUSES = new Set(Object.values(CANDIDATE_STATUS));

const VALID_TRANSITIONS = {
  [CANDIDATE_STATUS.READY_FOR_REVIEW]: new Set([
    CANDIDATE_STATUS.SUBMITTED_BY_HUMAN,
    CANDIDATE_STATUS.DISCARDED
  ]),
  [CANDIDATE_STATUS.REFUSED_POLICY_BAN]: new Set([
    CANDIDATE_STATUS.DISCARDED
  ]),
  [CANDIDATE_STATUS.SUBMITTED_BY_HUMAN]: new Set(),
  [CANDIDATE_STATUS.DISCARDED]: new Set()
};

function normalizeCandidateRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    repo: row.repo,
    issueNumber: row.issueNumber ?? row.issue_number,
    title: row.title,
    branchName: row.branchName ?? row.branch_name,
    status: row.status,
    policyVerdict: row.policyVerdict ?? row.policy_verdict,
    policyReason: row.policyReason ?? row.policy_reason,
    policyRef: row.policyRef ?? row.policy_ref,
    disclosureText: row.disclosureText ?? row.disclosure_text,
    proposedChanges: row.proposedChanges ?? row.proposed_changes ?? null,
    testOutput: row.testOutput ?? row.test_output ?? null,
    submissionMetadata: row.submissionMetadata ?? row.submission_metadata ?? null,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at ?? null
  };
}

/**
 * Creates and records a bounty candidate.
 */
export async function createBountyCandidate({
  id = `cand-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  repo,
  issueNumber,
  title,
  branchName = null,
  status = CANDIDATE_STATUS.READY_FOR_REVIEW,
  policyVerdict = null,
  policyReason = null,
  policyRef = null,
  disclosureText = null,
  proposedChanges = null,
  testOutput = null
}) {
  if (!repo || !issueNumber) {
    throw new Error('repo and issueNumber are required to create a bounty candidate');
  }

  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid candidate status: ${status}`);
  }

  const candidate = {
    id,
    repo,
    issueNumber,
    title: title || `Issue #${issueNumber}`,
    branchName,
    status,
    policyVerdict,
    policyReason,
    policyRef,
    disclosureText,
    proposedChanges,
    testOutput,
    submissionMetadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!databaseEnabled) {
    memoryCandidateStore.set(id, candidate);
    return candidate;
  }

  const res = await query(`
    INSERT INTO bounty_candidates (
      id, repo, issue_number, title, branch_name, status,
      policy_verdict, policy_reason, policy_ref, disclosure_text,
      proposed_changes, test_output, submission_metadata, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, now(), now())
    RETURNING *
  `, [
    candidate.id,
    candidate.repo,
    candidate.issueNumber,
    candidate.title,
    candidate.branchName,
    candidate.status,
    candidate.policyVerdict,
    candidate.policyReason,
    candidate.policyRef,
    candidate.disclosureText,
    candidate.proposedChanges,
    candidate.testOutput,
    JSON.stringify(candidate.submissionMetadata)
  ]);

  return normalizeCandidateRow(res.rows[0]);
}

/**
 * Retrieves a candidate by ID.
 */
export async function getBountyCandidate(id) {
  if (!databaseEnabled) {
    return memoryCandidateStore.get(id) || null;
  }

  const res = await query('SELECT * FROM bounty_candidates WHERE id = $1', [id]);
  return normalizeCandidateRow(res.rows[0]);
}

/**
 * Lists candidates with optional filters.
 */
export async function listBountyCandidates({ repo = null, status = null, limit = 50 } = {}) {
  if (!databaseEnabled) {
    let list = Array.from(memoryCandidateStore.values());
    if (repo) list = list.filter(c => c.repo === repo);
    if (status) list = list.filter(c => c.status === status);
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
  }

  const conditions = [];
  const params = [];
  if (repo) {
    params.push(repo);
    conditions.push(`repo = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const sql = `SELECT * FROM bounty_candidates ${where} ORDER BY created_at DESC LIMIT $${params.length}`;

  const res = await query(sql, params);
  return res.rows.map(normalizeCandidateRow);
}

/**
 * Updates status of a candidate (strictly enforces human review transition).
 */
export async function updateBountyCandidateStatus(id, newStatus, { submissionMetadata = null } = {}) {
  if (!VALID_STATUSES.has(newStatus)) {
    throw new Error(`Unknown candidate status: "${newStatus}"`);
  }

  const candidate = await getBountyCandidate(id);
  if (!candidate) {
    throw new Error(`Bounty candidate not found: ${id}`);
  }

  const allowed = VALID_TRANSITIONS[candidate.status];
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid candidate status transition: ${candidate.status} -> ${newStatus}`);
  }

  if (!databaseEnabled) {
    const updated = {
      ...candidate,
      status: newStatus,
      submissionMetadata: submissionMetadata || candidate.submissionMetadata,
      updatedAt: new Date().toISOString()
    };
    memoryCandidateStore.set(id, updated);
    return updated;
  }

  const res = await query(`
    UPDATE bounty_candidates
    SET status = $2,
        submission_metadata = COALESCE($3::jsonb, submission_metadata),
        updated_at = now()
    WHERE id = $1
    RETURNING *
  `, [id, newStatus, submissionMetadata ? JSON.stringify(submissionMetadata) : null]);

  return normalizeCandidateRow(res.rows[0]);
}

export async function resetBountyCandidatesMemory() {
  memoryCandidateStore.clear();
  await truncateForTesting(['bounty_candidates']);
}
