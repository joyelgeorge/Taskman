import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRepoAiPolicy,
  AI_POLICY_VERDICT,
  STANDARD_DISCLOSURE_TEXT,
  createBountyCandidate,
  getBountyCandidate,
  listBountyCandidates,
  updateBountyCandidateStatus,
  resetBountyCandidatesMemory,
  CANDIDATE_STATUS
} from '@taskman/core';
import {
  dispatchCodingAgentWork,
  resetExecutionRunsMemory,
  listExecutionRuns
} from '../src/adapters/coding-agent-adapter.js';

test('AI Policy: identifies outright ban in contributing guidelines and extracts excerpt', () => {
  const banTexts = [
    'We do not accept AI-generated code or pull requests in this repository.',
    'Notice: AI contributions are strictly prohibited due to maintainer overhead.',
    'Ghostty project policy: zero-tolerance for AI generated content without pre-approval.',
    'Curl bug bounty update: We disallow AI-generated submissions after spam wave.'
  ];

  for (const text of banTexts) {
    const verdict = checkRepoAiPolicy({ contributingText: text, repo: 'curl/curl' });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.verdict, AI_POLICY_VERDICT.BANNED);
    assert.ok(verdict.reason.includes('prohibits'));
    assert.ok(verdict.policyRef.length > 5);
    assert.equal(verdict.disclosureText, null);
  }
});

test('AI Policy: identifies conditional policy requiring disclosure and formats mandatory text', () => {
  const conditionalText = `
    ## Contributing Guidelines
    AI-assisted contributions must be disclosed in the pull request description.
    All code must be manually verified and tested.
  `;

  const verdict = checkRepoAiPolicy({ contributingText: conditionalText, repo: 'example/open-source' });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.verdict, AI_POLICY_VERDICT.ALLOWED_WITH_CONDITIONS);
  assert.ok(verdict.disclosureText.includes('Taskman'));
  assert.ok(verdict.disclosureText.includes('Reviewed, verified, and submitted by a human operator'));
});

test('AI Policy: defaults to conditional with standard disclosure if repository has no AI statement', () => {
  const normalText = 'Please write tests and follow code formatting standards.';
  const verdict = checkRepoAiPolicy({ contributingText: normalText, repo: 'some/repo' });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.verdict, AI_POLICY_VERDICT.ALLOWED_WITH_CONDITIONS);
  assert.equal(verdict.disclosureText, STANDARD_DISCLOSURE_TEXT);
});

test('Bounty Candidate Store: state machine enforces human review workflow', async () => {
  await resetBountyCandidatesMemory();

  const candidate = await createBountyCandidate({
    repo: 'algora-partner/repo',
    issueNumber: 99,
    title: 'Fix edge case in payment calculator',
    branchName: 'feat/issue-99-fix-calc',
    policyVerdict: AI_POLICY_VERDICT.ALLOWED_WITH_CONDITIONS,
    disclosureText: STANDARD_DISCLOSURE_TEXT,
    proposedChanges: 'diff --git a/calc.js ...',
    testOutput: '15 passed'
  });

  assert.equal(candidate.status, CANDIDATE_STATUS.READY_FOR_REVIEW);

  // Transition: READY_FOR_REVIEW -> SUBMITTED_BY_HUMAN succeeds
  const updated = await updateBountyCandidateStatus(candidate.id, CANDIDATE_STATUS.SUBMITTED_BY_HUMAN, {
    submissionMetadata: { prUrl: 'https://github.com/algora-partner/repo/pull/1', submittedBy: 'joyelgeorge' }
  });
  assert.equal(updated.status, CANDIDATE_STATUS.SUBMITTED_BY_HUMAN);
  assert.equal(updated.submissionMetadata.submittedBy, 'joyelgeorge');

  // Transition from terminal state throws
  await assert.rejects(
    async () => updateBountyCandidateStatus(candidate.id, CANDIDATE_STATUS.DISCARDED),
    /Invalid candidate status transition/
  );
});

test('Coding Agent: refuses external repo execution when AI contributions are banned', async () => {
  await resetExecutionRunsMemory();
  await resetBountyCandidatesMemory();

  let prCalled = false;
  const mockBackend = {
    provider: 'test',
    model: 'mock',
    async execute() {
      return { testsPassed: true, testOutput: 'all tests pass' };
    },
    async createOrUpdatePr() {
      prCalled = true;
      return { prNumber: 1, prUrl: 'https://github.com/external/banned-repo/pull/1' };
    }
  };

  const res = await dispatchCodingAgentWork({
    workPackage: {
      repo: 'external/banned-repo',
      issueNumber: 12,
      title: 'Fix issue',
      isBounty: true,
      contributingText: 'We do not accept AI pull requests.'
    },
    backend: mockBackend
  });

  assert.equal(res.ok, false);
  assert.equal(res.status, 'POLICY_REFUSED');
  assert.equal(prCalled, false); // Invariant: PR creation NEVER called on banned repo

  const candidates = await listBountyCandidates({ repo: 'external/banned-repo' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, CANDIDATE_STATUS.REFUSED_POLICY_BAN);
  assert.ok(candidates[0].policyReason.includes('prohibits'));
});

test('Coding Agent: never auto-submits external bounty PR; prepares candidate for human decision', async () => {
  await resetExecutionRunsMemory();
  await resetBountyCandidatesMemory();

  let prCreated = false;
  const mockBackend = {
    provider: 'test-ai',
    model: 'coder-v2',
    async execute() {
      return {
        testsPassed: true,
        testOutput: '✔ 20 unit tests pass (12ms)',
        proposedChanges: 'diff --git a/index.js...',
        headSha: 'cafebabe123456789'
      };
    },
    async createOrUpdatePr() {
      prCreated = true;
      return { prNumber: 10, prUrl: 'https://github.com/external/bounty-repo/pull/10' };
    }
  };

  const res = await dispatchCodingAgentWork({
    workPackage: {
      repo: 'external/bounty-repo',
      issueNumber: 55,
      title: 'Implement token bucket rate limiter',
      isBounty: true,
      contributingText: 'AI-assisted PRs must be disclosed.'
    },
    backend: mockBackend
  });

  // Must succeed with CANDIDATE_PREPARED, NOT opening an automated PR
  assert.equal(res.ok, true);
  assert.equal(res.status, 'CANDIDATE_PREPARED');
  assert.equal(prCreated, false); // NEVER opens PR automatically
  assert.ok(res.candidateId);
  assert.ok(res.disclosureText.includes('Taskman'));

  const candidate = await getBountyCandidate(res.candidateId);
  assert.equal(candidate.status, CANDIDATE_STATUS.READY_FOR_REVIEW);
  assert.equal(candidate.issueNumber, 55);
  assert.ok(candidate.testOutput.includes('20 unit tests pass'));
});

test('API routes: /api/bounties/candidates handles listing, retrieval and review status transitions', async () => {
  await resetBountyCandidatesMemory();
  const { route } = await import('../packages/api/routes.js');

  // Create a candidate
  const cand = await createBountyCandidate({
    repo: 'acme/lib',
    issueNumber: 10,
    title: 'Speed up json serialization',
    disclosureText: STANDARD_DISCLOSURE_TEXT,
    proposedChanges: 'diff patch'
  });

  // 1. GET /api/bounties/candidates
  const listReq = { method: 'GET', headers: {} };
  const listUrl = new URL('http://localhost/api/bounties/candidates');
  const listRes = await route(listReq, listUrl, async () => ({}));
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.candidates.length, 1);
  assert.equal(listRes.body.candidates[0].id, cand.id);

  // 2. GET /api/bounties/candidates/:id
  const getReq = { method: 'GET', headers: {} };
  const getUrl = new URL(`http://localhost/api/bounties/candidates/${cand.id}`);
  const getRes = await route(getReq, getUrl, async () => ({}));
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.candidate.id, cand.id);

  // 3. PATCH /api/bounties/candidates/:id -> SUBMITTED_BY_HUMAN
  const patchReq = { method: 'PATCH', headers: {} };
  const patchRes = await route(patchReq, getUrl, async () => ({
    status: CANDIDATE_STATUS.SUBMITTED_BY_HUMAN,
    submissionMetadata: { prUrl: 'https://github.com/acme/lib/pull/42' }
  }));
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.candidate.status, CANDIDATE_STATUS.SUBMITTED_BY_HUMAN);
  assert.equal(patchRes.body.candidate.submissionMetadata.prUrl, 'https://github.com/acme/lib/pull/42');
});

