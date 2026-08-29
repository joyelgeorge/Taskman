import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPollReport,
  isExplicitlyBlocked,
  issueCoveredByOpenPr,
  selectActionableIssues
} from '../scripts/poll-tasks.mjs';

test('selects newest actionable issues instead of a hardcoded issue range', () => {
  const issues = [
    { number: 10, title: 'Older task', labels: [] },
    { number: 22, title: 'Readiness probes', labels: [] },
    { number: 23, title: 'Execution deadlines', labels: [] },
    { number: 24, title: 'Dashboard failures', labels: [] }
  ];

  assert.deepEqual(
    selectActionableIssues(issues, [], 3).map(issue => issue.number),
    [24, 23, 22]
  );
});

test('does not select an issue already referenced by an open PR', () => {
  const issues = [
    { number: 22, title: 'Readiness probes', labels: [] },
    { number: 23, title: 'Execution deadlines', labels: [] },
    { number: 24, title: 'Dashboard failures', labels: [] }
  ];
  const pullRequests = [
    { number: 25, title: 'Fix dashboard', body: 'Closes #24' }
  ];

  assert.equal(issueCoveredByOpenPr(issues[2], pullRequests), true);
  assert.deepEqual(
    selectActionableIssues(issues, pullRequests, 3).map(issue => issue.number),
    [23, 22]
  );
});

test('issue references use a numeric boundary', () => {
  const issue = { number: 22, labels: [] };
  assert.equal(issueCoveredByOpenPr(issue, [{ title: 'Closes #220', body: '' }]), false);
  assert.equal(issueCoveredByOpenPr(issue, [{ title: '', body: 'Fixes #22.' }]), true);
});

test('skips only issues carrying an explicit blocked label', () => {
  assert.equal(isExplicitlyBlocked({ labels: [{ name: 'blocked' }] }), true);
  assert.equal(isExplicitlyBlocked({ labels: [{ name: 'enhancement' }] }), false);

  const issues = [
    { number: 25, labels: [{ name: 'waiting' }] },
    { number: 24, labels: [{ name: 'enhancement' }] }
  ];
  assert.deepEqual(selectActionableIssues(issues, [], 3).map(x => x.number), [24]);
});

test('priority labels outrank recency and report exposes picked work', () => {
  const report = buildPollReport({
    issues: [
      { number: 30, title: 'Newest', labels: [] },
      { number: 22, title: 'Critical', labels: [{ name: 'P0' }] }
    ],
    pullRequests: [],
    todos: [],
    limit: 3
  });

  assert.deepEqual(report.pickedIssues.map(issue => issue.number), [22, 30]);
  assert.match(report.nextAction, /Implement each picked issue/);
});
