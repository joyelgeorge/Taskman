#!/usr/bin/env node
/** Flies the GitHub bounty hunt once and prints what qualifies. Read-only. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { qualify, HUNT_QUERIES } from '../packages/core/bounties/github-hunt.js';

const sh = promisify(execFile);
const api = async (p) => JSON.parse((await sh('gh', ['api', '--cache', '120s', p], { maxBuffer: 5e7 })).stdout);

const issues = new Map();
for (const q of HUNT_QUERIES) {
  try {
    const j = await api(`/search/issues?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=100`);
    for (const it of j.items || []) issues.set(it.html_url, it);
  } catch (e) { console.error('query failed:', q, String(e.message).slice(0, 80)); }
}

const repos = new Map();
const listings = [];
for (const it of issues.values()) {
  const repoFullName = it.repository_url.split('/').slice(-2).join('/');
  if (!repos.has(repoFullName)) {
    try { repos.set(repoFullName, await api(`/repos/${repoFullName}`)); } catch { repos.set(repoFullName, null); }
  }
  const r = repos.get(repoFullName);
  // A linked timeline entry of type "cross-referenced" from a PR, or an
  // assignee, is how we tell a live-and-claimable bounty from a swarmed one.
  const assignee = it.assignee?.login || null;
  let competingPrs = 0;
  if (!assignee) {
    // Count open PRs in the same repo whose title names this issue number.
    try {
      const num = it.number;
      const linked = await api(`/search/issues?q=${encodeURIComponent(`repo:${repoFullName} is:pr is:open ${num}`)}&per_page=20`);
      competingPrs = (linked.items || []).filter((pr) => new RegExp(`\\b${num}\\b`).test(pr.title)).length;
    } catch { /* leave at 0 */ }
  }
  listings.push({
    repoFullName, stars: r?.stargazers_count ?? 0,
    pushedAt: r?.pushed_at ?? '1970-01-01T00:00:00Z',
    assignee, competingPrs,
    title: it.title, body: (it.body || '').slice(0, 8000), url: it.html_url
  });
}

const { qualified, rejected } = qualify(listings);
console.log(`pulled ${listings.length} listings across ${HUNT_QUERIES.length} queries`);
console.log(`qualified ${qualified.length} | rejected ${rejected.length}\n`);
for (const q of qualified.slice(0, 20))
  console.log(` net $${String(q.net).padStart(5)}  gross $${String(q.gross).padStart(5)}  ${q.rail.padEnd(9)} ${(q.stars + '★').padStart(7)}  ${q.repoFullName.slice(0, 30).padEnd(32)} ${q.title.slice(0, 44)}`);
const why = {};
for (const r of rejected) { const k = r.reason.split(':')[0]; why[k] = (why[k] || 0) + 1; }
console.log('\nrejected because:', JSON.stringify(why, null, 0));
console.log('total net if every qualified listing paid: $' + qualified.reduce((a, q) => a + q.net, 0));
