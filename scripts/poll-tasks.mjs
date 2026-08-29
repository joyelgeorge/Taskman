#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BLOCKED_LABELS = new Set([
  'blocked',
  'waiting',
  'on-hold',
  'status: blocked',
  'status: waiting'
]);

function normalizeLabel(label) {
  return String(label?.name ?? label ?? '').trim().toLowerCase();
}

export function isExplicitlyBlocked(issue) {
  return (issue.labels || []).some(label => BLOCKED_LABELS.has(normalizeLabel(label)));
}

export function issueCoveredByOpenPr(issue, pullRequests) {
  const pattern = new RegExp(`#${issue.number}(?!\\d)`, 'i');
  return pullRequests.some(pr => pattern.test(`${pr.title || ''}\n${pr.body || ''}`));
}

function priorityRank(issue) {
  const labels = new Set((issue.labels || []).map(normalizeLabel));
  if (labels.has('p0') || labels.has('priority: critical') || labels.has('critical')) return 3;
  if (labels.has('p1') || labels.has('priority: high') || labels.has('high priority')) return 2;
  if (labels.has('p2') || labels.has('priority: medium')) return 1;
  return 0;
}

export function selectActionableIssues(issues, pullRequests, limit = 3) {
  const take = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 3;
  return issues
    .filter(issue => !isExplicitlyBlocked(issue))
    .filter(issue => !issueCoveredByOpenPr(issue, pullRequests))
    .sort((a, b) =>
      priorityRank(b) - priorityRank(a) ||
      Number(b.number) - Number(a.number)
    )
    .slice(0, take);
}

function ghJson(args) {
  const gh = process.env.GH_BIN || 'gh';
  const output = execFileSync(gh, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return JSON.parse(output || '[]');
}

function scanTodos() {
  try {
    const output = execFileSync('git', [
      'grep', '-n', '-E', 'TODO|FIXME', '--', 'src', 'public', 'scripts', 'test'
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output
      .split('\n')
      .filter(Boolean)
      .filter(line => !line.startsWith('scripts/poll-tasks.mjs:'))
      .filter(line => !line.startsWith('test/poll-tasks.test.js:'));
  } catch {
    return [];
  }
}

export function buildPollReport({ issues, pullRequests, todos, limit }) {
  const pickedIssues = selectActionableIssues(issues, pullRequests, limit);
  const pullRequestsNeedingAttention = pullRequests.filter(pr =>
    pr.reviewDecision === 'CHANGES_REQUESTED' ||
    pr.isDraft === true
  );

  return {
    repository: process.env.TASKMAN_REPO || 'joyelgeorge/Taskman',
    checkedAt: new Date().toISOString(),
    openIssueCount: issues.length,
    openPullRequestCount: pullRequests.length,
    pullRequestsNeedingAttention,
    pickedIssues,
    localTodos: todos,
    nextAction: pickedIssues.length
      ? 'Implement each picked issue on its own feature branch and PR; test before pushing; do not merge without explicit approval.'
      : pullRequestsNeedingAttention.length
        ? 'Address pull-request review requests and failing checks.'
        : todos.length
          ? 'Review actionable TODO/FIXME items.'
          : 'No actionable work found.'
  };
}

export function main() {
  const repository = process.env.TASKMAN_REPO || 'joyelgeorge/Taskman';
  const limit = Number(process.env.TASKMAN_MAX_ISSUES || 3);

  const pullRequests = ghJson([
    'pr', 'list',
    '--repo', repository,
    '--state', 'open',
    '--limit', '100',
    '--json', 'number,title,body,url,headRefName,reviewDecision,isDraft'
  ]);

  const issues = ghJson([
    'issue', 'list',
    '--repo', repository,
    '--state', 'open',
    '--limit', '100',
    '--json', 'number,title,body,url,labels,createdAt,updatedAt'
  ]);

  const report = buildPollReport({
    issues,
    pullRequests,
    todos: scanTodos(),
    limit
  });

  console.log(JSON.stringify(report, null, 2));
  console.log(`PICKED_ISSUES_JSON=${JSON.stringify(report.pickedIssues)}`);
}

const invokedDirectly = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`Taskman poller failed: ${error.message || error}`);
    process.exitCode = 1;
  }
}
