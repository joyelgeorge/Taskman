import test from 'node:test';
import assert from 'node:assert/strict';
import { disqualify, qualify, extractAmount, detectRail } from '../packages/core/bounties/github-hunt.js';

const NOW = new Date('2026-09-07T00:00:00Z');
const fresh = '2026-09-07T00:00:00Z';
const base = { repoFullName: 'acme/widget', stars: 500, pushedAt: fresh, title: '', body: '' };

// Every case below is a listing actually returned by the live hunt on 2026-09-07.

test('keeps the genuine one: tenstorrent $5000 correctness bug', () => {
  assert.equal(disqualify({
    ...base, repoFullName: 'tenstorrent/tt-metal', stars: 1661,
    title: '[Bounty $5000] Fix INT_MIN correctness in int32 division'
  }, { now: NOW }), null);
});

test('rejects the aggregator that was 81% of the raw sample', () => {
  const reason = disqualify({
    ...base, repoFullName: 'zhangjiayang6835-cyber/bounty-plaza', stars: 8,
    pushedAt: '2026-07-12T00:00:00Z', title: '[Bounty $25000] implement SlopStation core layout'
  }, { now: NOW });
  assert.match(reason, /aggregator/);
});

test('rejects the credits catalogue whose $18000 is a recorded offer, not a bounty', () => {
  const reason = disqualify({
    ...base, repoFullName: 'sourcey/startup-credits', stars: 186,
    title: 'data: add Lightdash startup program', body: 'Worth $18,000 in credits.'
  }, { now: NOW });
  assert.match(reason, /catalogue/);
});

test('rejects the farm paying $780 for pixel art', () => {
  const reason = disqualify({
    ...base, repoFullName: 'SecureBananaLabs/bug-bounty', stars: 293,
    title: 'feat: add gold coin pixel art asset', body: 'Reward: $780'
  }, { now: NOW });
  assert.match(reason, /farm signature/);
});

test('a low amount for trivial work is not a farm — the pair is the tell', () => {
  assert.equal(disqualify({
    ...base, title: 'Fix typo in README', body: 'We will pay $50.'
  }, { now: NOW }), null);
});

test('rejects Algora on the rail, not on the merits', () => {
  const reason = disqualify({
    ...base, title: 'Add retry logic', body: 'Funded via Algora. /bounty $400'
  }, { now: NOW });
  assert.match(reason, /rail unreachable/);
});

test('rejects a stale repo and a thin repo with distinguishable reasons', () => {
  assert.match(disqualify({ ...base, pushedAt: '2025-01-01T00:00:00Z', body: '$300' }, { now: NOW }), /stale repo/);
  assert.match(disqualify({ ...base, stars: 3, body: '$300' }, { now: NOW }), /thin repo/);
});

test('extractAmount takes the largest credible figure and ignores noise', () => {
  assert.equal(extractAmount('pays $250, not $3 and not $999999'), 250);
  assert.equal(extractAmount('no money here'), null);
  assert.equal(extractAmount('USD 1,500 for this'), 1500);
});

test('net is discounted by the real cost of each rail', () => {
  const { qualified } = qualify([
    { ...base, title: 'A', body: 'Paid via PayPal. $1000' },
    { ...base, title: 'B', body: 'Paid in USDC. $1000' }
  ], { now: NOW });
  const paypal = qualified.find((q) => q.rail === 'paypal');
  const crypto = qualified.find((q) => q.rail === 'crypto');
  assert.equal(paypal.net, 906);   // 4.4% + 3.5% FX
  assert.equal(crypto.net, 690);   // 30% VDA + 1% TDS
  assert.ok(qualified[0].net >= qualified[1].net, 'best net sorts first');
});

test('detectRail prefers the explicit rail over an incidental crypto mention', () => {
  assert.equal(detectRail('paid by PayPal, repo is about wallet software').key, 'paypal');
});

test('rejections carry a reason that can be argued with', () => {
  const { rejected } = qualify([{ ...base, stars: 1, body: '$500' }], { now: NOW });
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason.length > 0);
});

test("rejects another contributor's claim, which the live hunt ranked first at $15,000", () => {
  const reason = disqualify({
    repoFullName: 'Scottcjn/rustchain-bounties', stars: 261, pushedAt: '2026-09-07T00:00:00Z',
    title: '[BOUNTY CLAIM] gaussagent High-Value Bounty Request', body: 'Requesting $15,000 for work completed.'
  }, { now: new Date('2026-09-07T00:00:00Z') });
  assert.match(reason, /already claimed/);
});

test('rejects an assigned bounty, however real — the tenstorrent lesson', () => {
  const reason = disqualify({
    repoFullName: 'tenstorrent/tt-metal', stars: 1661, pushedAt: '2026-09-07T00:00:00Z',
    title: '[Bounty $5000] Fix INT_MIN correctness', body: 'pays $5000',
    assignee: 'jasondavies'
  }, { now: new Date('2026-09-07T00:00:00Z') });
  assert.match(reason, /assigned: already claimed by @jasondavies/);
});

test('rejects a contested bounty that already has solution PRs', () => {
  const reason = disqualify({
    repoFullName: 'acme/x', stars: 500, pushedAt: '2026-09-07T00:00:00Z',
    title: 'Fix bug', body: 'pays $400', competingPrs: 2
  }, { now: new Date('2026-09-07T00:00:00Z') });
  assert.match(reason, /contested: 2 solution/);
});

test('rejects a bounty gated on hardware the operator cannot test', () => {
  const reason = disqualify({
    repoFullName: 'acme/x', stars: 500, pushedAt: '2026-09-07T00:00:00Z',
    title: 'Fix kernel', body: 'INT_MIN on Wormhole and Blackhole LLK. pays $5000'
  }, { now: new Date('2026-09-07T00:00:00Z') });
  assert.match(reason, /hardware-gated: needs Tenstorrent/);
});

test('a normal software bounty with no assignee, no PRs, no hardware still passes', () => {
  assert.equal(disqualify({
    repoFullName: 'acme/x', stars: 500, pushedAt: '2026-09-07T00:00:00Z',
    title: 'Add retry on 429', body: 'we will pay $300 via paypal', assignee: null, competingPrs: 0
  }, { now: new Date('2026-09-07T00:00:00Z') }), null);
});
