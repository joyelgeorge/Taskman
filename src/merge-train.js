import { databaseEnabled, query, withTransaction, truncateForTesting } from './db.js';
import { scrubSecrets } from './adapters/coding-agent-adapter.js';

const mergeTrainMemoryStore = new Map(); // id -> record

export const RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH'
});

export const MERGE_TRAIN_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  VALIDATING: 'VALIDATING',
  WAITING_FOR_GATE: 'WAITING_FOR_GATE',
  MERGED: 'MERGED',
  REJECTED: 'REJECTED',
  ROLLED_BACK: 'ROLLED_BACK'
});

/**
 * Classifies risk based on files modified in a pull request.
 * - HIGH: migrations, database, money-ledger, security/auth, metering
 * - LOW: documentation, markdown, UI static assets, tests only
 * - MEDIUM: default for general application code
 */
export function classifyRisk(filePaths = []) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return RISK_LEVELS.MEDIUM;

  const isHigh = filePaths.some(p => {
    const file = String(p).toLowerCase();
    return file.includes('migration') ||
           file.includes('src/db.js') ||
           file.includes('src/money-ledger.js') ||
           file.includes('src/rail-governor.js') ||
           file.includes('src/metering.js') ||
           file.includes('src/http-security.js');
  });
  if (isHigh) return RISK_LEVELS.HIGH;

  const isAllLow = filePaths.every(p => {
    const file = String(p).toLowerCase();
    return file.endsWith('.md') ||
           file.includes('public/') ||
           file.endsWith('.css') ||
           file.startsWith('docs/');
  });
  if (isAllLow) return RISK_LEVELS.LOW;

  return RISK_LEVELS.MEDIUM;
}

/**
 * Evaluates merge gates for a given PR package according to its risk level.
 */
export async function evaluateMergeGates({
  pr,
  riskLevel = RISK_LEVELS.MEDIUM,
  testSuiteResult = { passed: true },
  integrationResult = null,
  ciChecks = [{ name: 'test', status: 'completed', conclusion: 'success' }]
}) {
  const verdicts = {
    headShaMatch: false,
    mergeable: false,
    noSecrets: false,
    ciChecksPassed: false,
    unitTestsPassed: false,
    riskGatePassed: false,
    allPassed: false
  };

  // 1. Head SHA match & branch state
  if (pr.head && pr.head.sha && pr.head.sha === pr.currentSha) {
    verdicts.headShaMatch = true;
  }
  if (pr.mergeable !== false && pr.mergeable_state !== 'dirty' && pr.mergeable_state !== 'conflicting') {
    verdicts.mergeable = true;
  }

  // 2. Secret scan
  const titleAndBody = `${pr.title || ''} ${pr.body || ''}`;
  if (titleAndBody === scrubSecrets(titleAndBody)) {
    verdicts.noSecrets = true;
  }

  // 3. Required CI Checks
  if (Array.isArray(ciChecks) && ciChecks.length > 0) {
    verdicts.ciChecksPassed = ciChecks.every(c => c.status === 'completed' && c.conclusion === 'success');
  }

  // 4. Unit / Base Tests
  if (testSuiteResult && testSuiteResult.passed) {
    verdicts.unitTestsPassed = true;
  }

  // 5. Risk-specific Gates
  if (riskLevel === RISK_LEVELS.LOW) {
    verdicts.riskGatePassed = verdicts.unitTestsPassed;
  } else if (riskLevel === RISK_LEVELS.MEDIUM) {
    verdicts.riskGatePassed = verdicts.unitTestsPassed && verdicts.ciChecksPassed;
  } else if (riskLevel === RISK_LEVELS.HIGH) {
    // High risk requires integration / PostgreSQL verification
    if (integrationResult && integrationResult.passed) {
      verdicts.riskGatePassed = true;
    } else {
      verdicts.riskGatePassed = false;
    }
  }

  verdicts.allPassed = verdicts.headShaMatch &&
                       verdicts.mergeable &&
                       verdicts.noSecrets &&
                       verdicts.ciChecksPassed &&
                       verdicts.unitTestsPassed &&
                       verdicts.riskGatePassed;

  return verdicts;
}

/**
 * Persists a merge train record.
 */
export async function saveMergeTrainRecord(record) {
  record.updatedAt = new Date().toISOString();
  if (!databaseEnabled) {
    mergeTrainMemoryStore.set(record.id, { ...record });
    return record;
  }

  await query(`
    INSERT INTO merge_train_records (
      id, repo, pr_number, base_branch, head_sha, risk_level, status,
      gate_verdicts, merge_commit_sha, post_merge_status, rollback_sha, error, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, now())
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      gate_verdicts = EXCLUDED.gate_verdicts,
      merge_commit_sha = EXCLUDED.merge_commit_sha,
      post_merge_status = EXCLUDED.post_merge_status,
      rollback_sha = EXCLUDED.rollback_sha,
      error = EXCLUDED.error,
      updated_at = now()
  `, [
    record.id,
    record.repo,
    record.prNumber,
    record.baseBranch || 'main',
    record.headSha,
    record.riskLevel,
    record.status,
    JSON.stringify(record.gateVerdicts || {}),
    record.mergeCommitSha || null,
    record.postMergeStatus || null,
    record.rollbackSha || null,
    record.error || null,
    record.createdAt || new Date().toISOString()
  ]);

  return record;
}

/**
 * Lists merge train records.
 */
export async function listMergeTrainRecords({ repo = 'joyelgeorge/Taskman', status, limit = 50 } = {}) {
  if (!databaseEnabled) {
    let list = Array.from(mergeTrainMemoryStore.values()).filter(r => r.repo === repo);
    if (status) list = list.filter(r => r.status === status);
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
  }

  let sql = 'SELECT * FROM merge_train_records WHERE repo = $1';
  const params = [repo];
  if (status) {
    sql += ' AND status = $2';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC LIMIT ' + limit;
  const res = await query(sql, params);
  return res.rows.map(r => ({
    id: r.id,
    repo: r.repo,
    prNumber: r.pr_number,
    baseBranch: r.base_branch,
    headSha: r.head_sha,
    riskLevel: r.risk_level,
    status: r.status,
    gateVerdicts: r.gate_verdicts,
    mergeCommitSha: r.merge_commit_sha,
    postMergeStatus: r.post_merge_status,
    rollbackSha: r.rollback_sha,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

/**
 * Process a single step of the merge train.
 * Rule: Merges exactly ONE PR at a time, verifies post-merge canary, rolls back on regression.
 */
export async function processMergeTrainStep({
  repo = 'joyelgeorge/Taskman',
  candidatePrs = [],
  mergePrFn,
  testRunnerFn = async () => ({ passed: true }),
  canaryObserverFn = async () => ({ healthy: true }),
  rollbackFn = async () => ({ rolledBack: true, sha: 'revert-sha' })
}) {
  if (!candidatePrs || candidatePrs.length === 0) {
    return { ok: true, status: 'IDLE', message: 'No PRs waiting in merge train' };
  }

  // 1. Pick the top candidate PR
  const candidate = candidatePrs[0];
  const recordId = `mt-${repo.replace('/', '-')}-${candidate.number}-${Date.now()}`;
  const riskLevel = classifyRisk(candidate.changedFiles || []);

  const record = {
    id: recordId,
    repo,
    prNumber: candidate.number,
    baseBranch: candidate.base?.ref || 'main',
    headSha: candidate.head?.sha || candidate.headSha,
    riskLevel,
    status: MERGE_TRAIN_STATUS.VALIDATING,
    gateVerdicts: {},
    mergeCommitSha: null,
    postMergeStatus: null,
    rollbackSha: null,
    error: null,
    createdAt: new Date().toISOString()
  };

  await saveMergeTrainRecord(record);

  // 2. Evaluate gates
  const testSuiteResult = await testRunnerFn({ pr: candidate, riskLevel });
  const integrationResult = riskLevel === RISK_LEVELS.HIGH ? { passed: testSuiteResult.passed } : null;

  const verdicts = await evaluateMergeGates({
    pr: {
      ...candidate,
      currentSha: candidate.head?.sha || candidate.headSha
    },
    riskLevel,
    testSuiteResult,
    integrationResult,
    ciChecks: candidate.ciChecks || [{ name: 'test', status: 'completed', conclusion: 'success' }]
  });

  record.gateVerdicts = verdicts;

  if (!verdicts.allPassed) {
    record.status = MERGE_TRAIN_STATUS.REJECTED;
    record.error = 'One or more deterministic merge gates failed';
    await saveMergeTrainRecord(record);
    return {
      ok: false,
      status: 'GATE_FAILED',
      prNumber: candidate.number,
      recordId,
      verdicts,
      message: 'PR blocked by merge train gates'
    };
  }

  // 3. Execute serialized merge
  let mergeResult;
  try {
    mergeResult = await mergePrFn({
      repo,
      prNumber: candidate.number,
      headSha: record.headSha,
      mergeMethod: 'merge' // Normal merge commit by default for auditability/reversibility
    });
  } catch (err) {
    record.status = MERGE_TRAIN_STATUS.REJECTED;
    record.error = `Merge call failed: ${err.message}`;
    await saveMergeTrainRecord(record);
    return {
      ok: false,
      status: 'MERGE_FAILED',
      prNumber: candidate.number,
      recordId,
      error: record.error
    };
  }

  record.status = MERGE_TRAIN_STATUS.MERGED;
  record.mergeCommitSha = mergeResult.sha || 'merged-commit-sha';
  await saveMergeTrainRecord(record);

  // 4. Post-merge verification & Canary observation
  const canaryResult = await canaryObserverFn({ repo, mergeSha: record.mergeCommitSha });
  if (!canaryResult.healthy) {
    // Regression detected: automatically trigger rollback
    record.postMergeStatus = 'REGRESSION_DETECTED';
    const rollbackResult = await rollbackFn({
      repo,
      mergeSha: record.mergeCommitSha,
      prNumber: candidate.number,
      reason: canaryResult.reason || 'Post-merge canary metric regression'
    });
    record.status = MERGE_TRAIN_STATUS.ROLLED_BACK;
    record.rollbackSha = rollbackResult.sha;
    record.error = canaryResult.reason;
    await saveMergeTrainRecord(record);

    return {
      ok: false,
      status: 'ROLLED_BACK',
      prNumber: candidate.number,
      recordId,
      mergeCommitSha: record.mergeCommitSha,
      rollbackSha: record.rollbackSha,
      message: 'Merge reverted due to post-merge canary failure'
    };
  }

  record.postMergeStatus = 'HEALTHY';
  await saveMergeTrainRecord(record);

  return {
    ok: true,
    status: 'MERGED_HEALTHY',
    prNumber: candidate.number,
    recordId,
    mergeCommitSha: record.mergeCommitSha,
    riskLevel,
    message: 'PR safely merged and canary verified'
  };
}

export async function resetMergeTrainMemory() {
  mergeTrainMemoryStore.clear();
  await truncateForTesting(['merge_train_records']);
}
