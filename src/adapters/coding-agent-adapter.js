import { databaseEnabled, query } from '../db.js';
import { stableErrorCode } from '../errors.js';

const runsMemoryStore = new Map(); // id -> run

/**
 * Scrubs potential secrets (tokens, keys, auth headers) from text.
 */
export function scrubSecrets(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/ghp_[a-zA-Z0-9]{30,}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/bearer\s+[a-zA-Z0-9._-]{20,}/gi, 'Bearer [REDACTED_TOKEN]');
}

/**
 * Generates canonical deterministic branch name for an issue.
 */
export function getIssueBranchName(issueNumber, title = '') {
  const slug = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
  return slug ? `feat/issue-${issueNumber}-${slug}` : `feat/issue-${issueNumber}`;
}

/**
 * Base Coding Agent Adapter Interface / Dispatcher
 */
export async function dispatchCodingAgentWork({
  workPackage,
  backend,
  recordRun = true
}) {
  if (!backend) {
    return {
      ok: false,
      status: 'SETUP_REQUIRED',
      reason: 'No coding agent backend configured or available'
    };
  }

  // Work package validation
  const {
    repo,
    issueNumber,
    title,
    body,
    branchName = getIssueBranchName(issueNumber, title),
    testCommand = 'npm test',
    allowedCapabilities = [],
    maxBudget = 1000
  } = workPackage;

  if (!repo || !issueNumber) {
    throw new Error('workPackage requires repo and issueNumber');
  }

  const runId = `run-${repo.replace('/', '-')}-${issueNumber}-${Date.now()}`;
  let runRecord = {
    id: runId,
    repo,
    issueNumber,
    branchName,
    status: 'STARTED',
    testOutput: null,
    provider: backend.provider || 'unknown',
    model: backend.model || 'unknown',
    tokenUsage: {},
    error: null,
    prNumber: null,
    prUrl: null,
    headSha: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (recordRun) {
    await saveExecutionRun(runRecord);
  }

  try {
    // 1. Run the backend to generate code/commits and run tests
    const backendResult = await backend.execute({
      repo,
      issueNumber,
      title: scrubSecrets(title),
      body: scrubSecrets(body),
      branchName,
      testCommand,
      allowedCapabilities,
      maxBudget
    });

    runRecord.provider = backendResult.provider || runRecord.provider;
    runRecord.model = backendResult.model || runRecord.model;
    runRecord.tokenUsage = backendResult.tokenUsage || {};
    runRecord.testOutput = scrubSecrets(backendResult.testOutput || '');
    runRecord.headSha = backendResult.headSha || null;

    // 2. Gate: Test evidence is mandatory before PR creation
    if (!backendResult.testsPassed) {
      runRecord.status = 'FAILED_TESTS';
      runRecord.error = scrubSecrets(backendResult.testError || 'Automated tests failed');
      if (recordRun) await saveExecutionRun(runRecord);
      return {
        ok: false,
        status: 'FAILED_TESTS',
        reason: runRecord.error,
        runId,
        testOutput: runRecord.testOutput
      };
    }

    // 3. Create or update PR via backend or GitHub client
    const prResult = await backend.createOrUpdatePr({
      repo,
      issueNumber,
      branchName,
      title: scrubSecrets(`feat: resolve #${issueNumber} - ${title}`),
      body: scrubSecrets(backendResult.prBody || `Automated implementation for #${issueNumber}.\n\nCloses #${issueNumber}\n\n### Test Evidence:\n\`\`\`\n${runRecord.testOutput.slice(0, 1000)}\n\`\`\``),
      headSha: runRecord.headSha
    });

    if (!prResult.prNumber) {
      runRecord.status = 'PR_FAILED';
      runRecord.error = prResult.error || 'Failed to open or update pull request';
      if (recordRun) await saveExecutionRun(runRecord);
      return {
        ok: false,
        status: 'PR_FAILED',
        reason: runRecord.error,
        runId
      };
    }

    runRecord.status = 'PR_OPENED';
    runRecord.prNumber = prResult.prNumber;
    runRecord.prUrl = prResult.prUrl;
    if (recordRun) await saveExecutionRun(runRecord);

    return {
      ok: true,
      status: 'PR_OPENED',
      runId,
      branch: branchName,
      prNumber: prResult.prNumber,
      prUrl: prResult.prUrl,
      headSha: runRecord.headSha,
      testResults: { passed: true, output: runRecord.testOutput },
      modelMetadata: { provider: runRecord.provider, model: runRecord.model },
      tokenUsage: runRecord.tokenUsage
    };
  } catch (err) {
    runRecord.status = 'ERROR';
    runRecord.error = scrubSecrets(err.message || String(err));
    if (recordRun) await saveExecutionRun(runRecord);
    return {
      ok: false,
      status: 'ERROR',
      reason: runRecord.error,
      runId
    };
  }
}

/**
 * Persists an execution run to database or memory
 */
export async function saveExecutionRun(run) {
  run.updatedAt = new Date().toISOString();
  if (!databaseEnabled) {
    runsMemoryStore.set(run.id, { ...run });
    return run;
  }

  await query(`
    INSERT INTO repo_execution_runs (
      id, repo, issue_number, branch_name, pr_number, pr_url, head_sha,
      status, test_output, provider, model, token_usage, error, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, now())
    ON CONFLICT (id) DO UPDATE SET
      pr_number = EXCLUDED.pr_number,
      pr_url = EXCLUDED.pr_url,
      head_sha = EXCLUDED.head_sha,
      status = EXCLUDED.status,
      test_output = EXCLUDED.test_output,
      token_usage = EXCLUDED.token_usage,
      error = EXCLUDED.error,
      updated_at = now()
  `, [
    run.id,
    run.repo,
    run.issueNumber,
    run.branchName,
    run.prNumber,
    run.prUrl,
    run.headSha,
    run.status,
    run.testOutput,
    run.provider,
    run.model,
    JSON.stringify(run.tokenUsage || {}),
    run.error,
    run.createdAt
  ]);
  return run;
}

export async function listExecutionRuns({ repo = 'joyelgeorge/Taskman', issueNumber, limit = 50 } = {}) {
  if (!databaseEnabled) {
    let list = Array.from(runsMemoryStore.values()).filter(r => r.repo === repo);
    if (issueNumber) list = list.filter(r => r.issueNumber === issueNumber);
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
  }

  let sql = 'SELECT * FROM repo_execution_runs WHERE repo = $1';
  const params = [repo];
  if (issueNumber) {
    sql += ' AND issue_number = $2';
    params.push(issueNumber);
  }
  sql += ' ORDER BY created_at DESC LIMIT ' + limit;
  const result = await query(sql, params);
  return result.rows.map(r => ({
    id: r.id,
    repo: r.repo,
    issueNumber: r.issue_number,
    branchName: r.branch_name,
    prNumber: r.pr_number,
    prUrl: r.pr_url,
    headSha: r.head_sha,
    status: r.status,
    testOutput: r.test_output,
    provider: r.provider,
    model: r.model,
    tokenUsage: r.token_usage,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

export function resetExecutionRunsMemory() {
  runsMemoryStore.clear();
}
