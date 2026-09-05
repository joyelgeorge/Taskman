import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchCodingAgentWork,
  scrubSecrets,
  getIssueBranchName,
  listExecutionRuns,
  resetExecutionRunsMemory
} from '../src/adapters/coding-agent-adapter.js';
import {
  WORK_ELIGIBILITY,
  claimActionableWorkItem,
  releaseActionableWorkItem,
  persistWorkItems,
  resetIntakeMemory
} from '../src/github-intake.js';
import { runExecuteWorker } from '../src/workers/execute.js';

test('scrubSecrets removes GitHub tokens, API keys and bearer headers', () => {
  const dirty = 'Here is token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 and openai sk-12345678901234567890 and Bearer secret-token-xyz-123456789012';
  const clean = scrubSecrets(dirty);
  assert.ok(!clean.includes('ghp_'));
  assert.ok(!clean.includes('sk-12345'));
  assert.ok(!clean.includes('secret-token'));
  assert.ok(clean.includes('[REDACTED_GITHUB_TOKEN]'));
  assert.ok(clean.includes('[REDACTED_API_KEY]'));
  assert.ok(clean.includes('Bearer [REDACTED_TOKEN]'));
});

test('getIssueBranchName produces valid canonical branch slug', () => {
  assert.equal(getIssueBranchName(122, 'P0 Execution: Dispatch eligible repo work!'), 'feat/issue-122-p0-execution-dispatch-eligible-repo-work');
  assert.equal(getIssueBranchName(83, ''), 'feat/issue-83');
});

test('dispatchCodingAgentWork returns SETUP_REQUIRED when backend is missing', async () => {
  await resetExecutionRunsMemory();
  const res = await dispatchCodingAgentWork({
    workPackage: { repo: 'test/repo', issueNumber: 122, title: 'Test issue' },
    backend: null
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 'SETUP_REQUIRED');
});

test('dispatchCodingAgentWork fails closed if tests fail before PR creation', async () => {
  await resetExecutionRunsMemory();
  let prCreated = false;
  const mockFailingBackend = {
    provider: 'mock-ai',
    model: 'mock-model-1',
    async execute() {
      return {
        testsPassed: false,
        testError: '1 failing test: assertion error in math.test.js',
        testOutput: 'AssertionError: 1 !== 2'
      };
    },
    async createOrUpdatePr() {
      prCreated = true;
      return { prNumber: 101, prUrl: 'https://github.com/test/repo/pull/101' };
    }
  };

  const res = await dispatchCodingAgentWork({
    workPackage: { repo: 'test/repo', issueNumber: 42, title: 'Fix math' },
    backend: mockFailingBackend
  });

  assert.equal(res.ok, false);
  assert.equal(res.status, 'FAILED_TESTS');
  assert.equal(prCreated, false); // PR must NOT be created on failing tests

  const runs = await listExecutionRuns({ repo: 'test/repo', issueNumber: 42 });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'FAILED_TESTS');
});

test('dispatchCodingAgentWork creates PR when tests pass and records metadata', async () => {
  await resetExecutionRunsMemory();
  const mockPassingBackend = {
    provider: 'mock-ai',
    model: 'mock-model-v2',
    async execute() {
      return {
        testsPassed: true,
        testOutput: '✔ 12 tests passed (45ms)',
        headSha: '0123456789abcdef0123456789abcdef01234567',
        tokenUsage: { input: 250, output: 80 }
      };
    },
    async createOrUpdatePr({ repo, issueNumber, branchName, title, body, headSha }) {
      assert.equal(issueNumber, 43);
      assert.ok(body.includes('Test Evidence'));
      return { prNumber: 102, prUrl: `https://github.com/${repo}/pull/102` };
    }
  };

  const res = await dispatchCodingAgentWork({
    workPackage: { repo: 'test/repo', issueNumber: 43, title: 'Add feature' },
    backend: mockPassingBackend
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, 'PR_OPENED');
  assert.equal(res.prNumber, 102);
  assert.equal(res.modelMetadata.provider, 'mock-ai');

  const runs = await listExecutionRuns({ repo: 'test/repo', issueNumber: 43 });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].prNumber, 102);
});

test('a mocked GitHub issue is leased exactly once and suppressed from duplicate dispatch', async () => {
  await resetIntakeMemory();
  const repo = 'test/repo';
  await persistWorkItems([
    {
      id: `${repo}#50`,
      repo,
      issueNumber: 50,
      title: 'P0 Work Item',
      state: 'open',
      labels: ['P0'],
      basePriority: 1000,
      effectivePriority: 1000,
      blockerIssueNumbers: [],
      blockingIssueNumbers: [],
      activePr: null,
      eligibilityStatus: WORK_ELIGIBILITY.READY,
      eligibilityReason: 'Ready for implementation',
      rawPayload: { body: 'Acceptance criteria: implement feature' }
    }
  ], repo);

  // Claim 1: succeeds
  const claim1 = await claimActionableWorkItem({ repo, claimedBy: 'worker-1' });
  assert.ok(claim1);
  assert.equal(claim1.issueNumber, 50);

  // Claim 2: immediate concurrent claim must return null (already leased)
  const claim2 = await claimActionableWorkItem({ repo, claimedBy: 'worker-2' });
  assert.equal(claim2, null);

  // Release claim1 so execute worker can claim and execute it
  await releaseActionableWorkItem({ repo, issueNumber: 50, claimedBy: 'worker-1' });

  // Execute worker with mock passing backend
  const mockBackend = {
    provider: 'test-llm',
    model: 'coder-v1',
    async execute() {
      return { testsPassed: true, testOutput: 'all pass', headSha: 'abcdef1234567890' };
    },
    async createOrUpdatePr() {
      return { prNumber: 200, prUrl: 'https://github.com/test/repo/pull/200' };
    }
  };

  // Run execute worker with repo work enabled
  const execResult = await runExecuteWorker({
    repo,
    executeRepoWork: true,
    codingAgentBackend: mockBackend,
    claimedBy: 'test-execute-runner'
  });

  assert.equal(execResult.repoExecution.ok, true);
  assert.equal(execResult.repoExecution.prNumber, 200);

  // Subsequent claim: suppressed because status became IN_FLIGHT_PR
  const claimAfter = await claimActionableWorkItem({ repo, claimedBy: 'worker-3' });
  assert.equal(claimAfter, null);
});
