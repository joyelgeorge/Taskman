import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIssueDependencies,
  extractPrIssueLinks,
  calculateBasePriority,
  normalizeAndRankWorkItems,
  fetchAllGitHubIssues,
  fetchAllGitHubPullRequests,
  persistWorkItems,
  getActionableWorkQueue,
  resetIntakeMemory,
  resetIntakeStore,
  WORK_ELIGIBILITY,
  PRIORITY_WEIGHTS
} from '../src/github-intake.js';

beforeEach(async () => {
  await resetIntakeStore();
});

test.after(async () => {
  await resetIntakeStore();
});

test('parseIssueDependencies extracts blockers from keywords and markdown sections', () => {
  const body1 = `
## Mission
Implement the intake loop.

Depends on #11, #12
Blocked by: #15
`;
  assert.deepEqual(parseIssueDependencies(body1), [11, 12, 15]);

  const body2 = `
## Dependencies
- #20
- #21

Related work:
- #25
`;
  assert.deepEqual(parseIssueDependencies(body2), [20, 21, 25]);

  assert.deepEqual(parseIssueDependencies(''), []);
  assert.deepEqual(parseIssueDependencies(null), []);
});

test('extractPrIssueLinks extracts issue numbers from branch, title, and body keywords', () => {
  const pr1 = {
    number: 103,
    title: 'Add authoritative usage metering (#83)',
    head: { ref: 'feat/issue-83-usage-metering' },
    body: 'Closes #83\n\nResolves #84'
  };
  assert.deepEqual(extractPrIssueLinks(pr1), [83, 84]);

  const pr2 = {
    number: 99,
    title: 'Random fix',
    head: { ref: 'fix/issue-121' },
    body: 'Just a tweak'
  };
  assert.deepEqual(extractPrIssueLinks(pr2), [121]);

  assert.deepEqual(extractPrIssueLinks(null), []);
});

test('calculateBasePriority classifies P0, P1, P2 and titles accurately', () => {
  assert.equal(calculateBasePriority({ labels: [{ name: 'high-priority' }], title: 'A task' }), PRIORITY_WEIGHTS.P0);
  assert.equal(calculateBasePriority({ labels: [{ name: 'priority:P0' }], title: 'A task' }), PRIORITY_WEIGHTS.P0);
  assert.equal(calculateBasePriority({ labels: [], title: 'P0 Critical bug' }), PRIORITY_WEIGHTS.P0);

  assert.equal(calculateBasePriority({ labels: [{ name: 'priority:P1' }], title: 'A task' }), PRIORITY_WEIGHTS.P1);
  assert.equal(calculateBasePriority({ labels: [{ name: 'priority:P2' }], title: 'A task' }), PRIORITY_WEIGHTS.P2);
  assert.equal(calculateBasePriority({ labels: [], title: 'Regular cleanup task' }), PRIORITY_WEIGHTS.DEFAULT);
});

test('dependency resolution blocks open dependents and elevates blocker priority', () => {
  const rawIssues = [
    {
      number: 11,
      title: 'P2 Foundation task',
      state: 'open',
      labels: [{ name: 'priority:P2' }],
      body: 'Basic foundation'
    },
    {
      number: 12,
      title: 'P0 High priority revenue task',
      state: 'open',
      labels: [{ name: 'high-priority' }],
      body: 'Depends on #11'
    }
  ];

  const ranked = normalizeAndRankWorkItems({ repo: 'test/repo', rawIssues, rawPullRequests: [] });

  const item11 = ranked.find(i => i.issueNumber === 11);
  const item12 = ranked.find(i => i.issueNumber === 12);

  assert.ok(item11);
  assert.ok(item12);

  // #12 should be BLOCKED because #11 is open
  assert.equal(item12.eligibilityStatus, WORK_ELIGIBILITY.BLOCKED);
  assert.match(item12.eligibilityReason, /Blocked by open issue.*#11/);

  // #11 is READY and inherits #12's P0 priority (1000) so the blocker is cleared first!
  assert.equal(item11.eligibilityStatus, WORK_ELIGIBILITY.READY);
  assert.equal(item11.effectivePriority, PRIORITY_WEIGHTS.P0);

  // In ranking, #11 outranks #12 because it is READY while #12 is BLOCKED
  assert.equal(ranked[0].issueNumber, 11);
  assert.equal(ranked[1].issueNumber, 12);
});

test('closing a blocker frees the dependent issue on the next intake cycle', () => {
  const rawIssues = [
    {
      number: 11,
      title: 'Foundation task',
      state: 'closed', // Closed now!
      labels: [],
      body: 'Done'
    },
    {
      number: 12,
      title: 'P0 Revenue task',
      state: 'open',
      labels: [{ name: 'high-priority' }],
      body: 'Depends on #11'
    }
  ];

  const ranked = normalizeAndRankWorkItems({ repo: 'test/repo', rawIssues, rawPullRequests: [] });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].issueNumber, 12);
  assert.equal(ranked[0].eligibilityStatus, WORK_ELIGIBILITY.READY);
  assert.match(ranked[0].eligibilityReason, /Dependencies satisfied/);
});

test('in-flight PR suppresses duplicate dispatch unless changes requested', () => {
  const rawIssues = [
    { number: 50, title: 'Feature 50', state: 'open', labels: [], body: '' },
    { number: 51, title: 'Feature 51', state: 'open', labels: [], body: '' }
  ];

  const rawPullRequests = [
    {
      number: 201,
      title: 'Implement feature 50',
      head: { ref: 'feat/issue-50' },
      body: 'Closes #50',
      reviewDecision: 'APPROVED',
      ciStatus: 'success'
    },
    {
      number: 202,
      title: 'Implement feature 51',
      head: { ref: 'feat/issue-51' },
      body: 'Closes #51',
      reviewDecision: 'CHANGES_REQUESTED',
      ciStatus: 'failure'
    }
  ];

  const ranked = normalizeAndRankWorkItems({ repo: 'test/repo', rawIssues, rawPullRequests });

  const item50 = ranked.find(i => i.issueNumber === 50);
  const item51 = ranked.find(i => i.issueNumber === 51);

  // Feature 50 is suppressed because healthy PR is in progress
  assert.equal(item50.eligibilityStatus, WORK_ELIGIBILITY.IN_FLIGHT_PR);

  // Feature 51 is eligible with NEEDS_PR_FIX because PR had changes requested / failed CI
  assert.equal(item51.eligibilityStatus, WORK_ELIGIBILITY.NEEDS_PR_FIX);
  assert.match(item51.eligibilityReason, /requires fixes/);

  // NEEDS_PR_FIX ranks above IN_FLIGHT_PR
  assert.equal(ranked[0].issueNumber, 51);
  assert.equal(ranked[1].issueNumber, 50);
});

test('deterministic tie-breaking orders equal priority by lower issue number (FIFO)', () => {
  const rawIssues = [
    { number: 108, title: 'P0 Onboarding', state: 'open', labels: [{ name: 'high-priority' }], body: '' },
    { number: 104, title: 'P0 Fiverr wedge', state: 'open', labels: [{ name: 'high-priority' }], body: '' },
    { number: 105, title: 'P0 Customer definition', state: 'open', labels: [{ name: 'high-priority' }], body: '' }
  ];

  const ranked = normalizeAndRankWorkItems({ repo: 'test/repo', rawIssues, rawPullRequests: [] });
  assert.deepEqual(ranked.map(i => i.issueNumber), [104, 105, 108]);
});

test('fetchAllGitHubIssues and pulls handle pagination cleanly', async () => {
  const mockFetch = async (url) => {
    const parsed = new URL(url);
    const page = parseInt(parsed.searchParams.get('page') || '1', 10);
    if (parsed.pathname.endsWith('/issues')) {
      if (page === 1) {
        return {
          ok: true,
          json: async () => [{ number: 1, title: 'Issue 1' }, { number: 2, title: 'Issue 2' }]
        };
      }
      return { ok: true, json: async () => [] };
    }
    if (parsed.pathname.endsWith('/pulls')) {
      if (page === 1) {
        return {
          ok: true,
          json: async () => [{ number: 10, title: 'PR 10', head: { ref: 'feat/1' } }]
        };
      }
      return { ok: true, json: async () => [] };
    }
    return { ok: false, status: 404, text: async () => 'not found' };
  };

  const issues = await fetchAllGitHubIssues({ repo: 'test/repo', fetchImpl: mockFetch, perPage: 2 });
  assert.equal(issues.length, 2);

  const prs = await fetchAllGitHubPullRequests({ repo: 'test/repo', fetchImpl: mockFetch, perPage: 1 });
  assert.equal(prs.length, 1);
});

test('work item persistence round-trips correctly into queue', async () => {
  const items = [
    {
      id: 'test/repo#10',
      repo: 'test/repo',
      issueNumber: 10,
      title: 'Test Issue 10',
      state: 'open',
      labels: ['P0'],
      basePriority: 1000,
      effectivePriority: 1000,
      blockerIssueNumbers: [],
      blockingIssueNumbers: [],
      activePr: null,
      eligibilityStatus: WORK_ELIGIBILITY.READY,
      eligibilityReason: 'Ready',
      rawPayload: {},
      githubUpdatedAt: new Date().toISOString()
    }
  ];

  await persistWorkItems(items, 'test/repo');
  const queue = await getActionableWorkQueue({ repo: 'test/repo' });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].issueNumber, 10);
  assert.equal(queue[0].eligibilityStatus, WORK_ELIGIBILITY.READY);
});
