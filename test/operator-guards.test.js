import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  GUARD_VERDICT, DEFAULT_LIMITS, evaluateNewLane, humanStepDebt, laneLoad,
  commitmentStatus, validateCommitment, isCapitalAtRisk
} from '../src/operator-guards.js';

const NOW = new Date('2026-09-20T09:00:00Z');

// Shaped like income_streams rows as they stood on 2026-09-16, trimmed.
const STREAMS = [
  { stream_key: 'payout-audit-direct', title: 'Payout reconciliation, sold directly', state: 'BLOCKED',
    unblocked_by: 'human', test_cost_hours: '1.00', updated_at: '2026-09-05T09:26:53Z' },
  { stream_key: 'github-paid-bounties', title: 'Algora bounties', state: 'BLOCKED',
    unblocked_by: 'human', test_cost_hours: '2.00', updated_at: '2026-09-19T07:40:29Z' },
  { stream_key: 'ephemeral-attention-dataset', title: 'Attention dataset', state: 'TESTING',
    unblocked_by: 'machine', test_cost_hours: '4.00', updated_at: '2026-09-05T06:00:36Z' },
  { stream_key: 'agent-task-boards', title: 'Agent boards', state: 'DISPROVEN',
    unblocked_by: 'machine', test_cost_hours: '0.00', updated_at: '2026-09-05T06:00:36Z' }
];

const COMMITMENT = {
  committedOn: '2026-09-16', reviewOn: '2026-12-15', status: 'active',
  primary: 'self-serve-scanner', background: ['ephemeral-attention-dataset'],
  killCriteria: [{ date: '2026-09-23', state: 'test purchase + launch post', ifMissed: 'stop starting' }],
  ifThen: [{ if: 'new idea', then: 'park it', minutes: 2 }]
};

const GOOD_PROPOSAL = {
  stream_key: 'fresh-idea', title: 'Invoice chasing for clinics', mechanism: 'Stripe payment link',
  unblocked_by: 'machine', payingDemandEvidence: 'three Fiverr gigs selling this at $40',
  killCriteria: [{ state: 'one paid customer', date: '2026-11-01' }]
};

const verdictOf = (result, filter) => result.reasons.find(r => r.filter === filter).verdict;

test('a complete proposal with nothing in the way is admitted', () => {
  const result = evaluateNewLane({ proposal: GOOD_PROPOSAL, streams: [], commitment: null, now: NOW });
  assert.equal(result.verdict, GUARD_VERDICT.ADMIT);
  assert.equal(result.reasons.length, 7, 'every filter reports, none short-circuits');
});

test('a proposal with no kill criterion is rejected, not parked', () => {
  const { killCriteria, ...noExit } = GOOD_PROPOSAL;
  const result = evaluateNewLane({ proposal: noExit, now: NOW });
  assert.equal(verdictOf(result, 'kill-criteria'), GUARD_VERDICT.REJECT);
  assert.equal(result.verdict, GUARD_VERDICT.REJECT);
});

test('a kill criterion dated in the past does not count as an exit', () => {
  const stale = { ...GOOD_PROPOSAL, killCriteria: [{ state: 'one paid customer', date: '2026-01-01' }] };
  assert.equal(verdictOf(evaluateNewLane({ proposal: stale, now: NOW }), 'kill-criteria'), GUARD_VERDICT.REJECT);
});

test('no evidence of paying demand parks the lane as a hypothesis', () => {
  const { payingDemandEvidence, ...unvalidated } = GOOD_PROPOSAL;
  assert.equal(verdictOf(evaluateNewLane({ proposal: unvalidated, now: NOW }), 'paying-demand'), GUARD_VERDICT.PARK);
});

test('capital-at-risk lanes are detected from their text, and uncapped ones are rejected', () => {
  const defi = { ...GOOD_PROPOSAL, title: 'DeFi Flashloan & Liquidation Hunting (Aave / Base)' };
  assert.equal(isCapitalAtRisk(defi), true);
  assert.equal(verdictOf(evaluateNewLane({ proposal: defi, now: NOW }), 'capital-risk'), GUARD_VERDICT.REJECT);

  const capped = { ...defi, capitalCapInr: 2000 };
  assert.equal(verdictOf(evaluateNewLane({ proposal: capped, now: NOW }), 'capital-risk'), GUARD_VERDICT.PARK);
});

test('ordinary trade and options-as-in-choices do not trip the capital filter', () => {
  assert.equal(isCapitalAtRisk({ title: 'India-Bhutan glove trade', mechanism: 'several options for export' }), false);
  assert.equal(isCapitalAtRisk({ title: 'Bitcoin price newsletter', capitalAtRisk: false }), false);
});

test('an overdue cheap human step parks every new lane and names the step', () => {
  const result = evaluateNewLane({ proposal: GOOD_PROPOSAL, streams: STREAMS, now: NOW });
  const debt = result.reasons.find(r => r.filter === 'human-step-debt');
  assert.equal(debt.verdict, GUARD_VERDICT.PARK);
  assert.match(debt.why, /Payout reconciliation, sold directly/);
});

test('human-step debt lists the overdue, cheapest step first', () => {
  const debt = humanStepDebt({ streams: STREAMS, now: NOW });
  assert.equal(debt[0].stream_key, 'payout-audit-direct');
  assert.equal(debt[0].overdue, true);
  // Bounties went BLOCKED one day ago: inside the grace period, so not yet debt.
  assert.equal(debt.find(d => d.stream_key === 'github-paid-bounties').overdue, false);
});

test('under an active commitment, human steps on other lanes are parked, not debt', () => {
  const debt = humanStepDebt({ streams: STREAMS, now: NOW, commitment: COMMITMENT });
  const payout = debt.find(d => d.stream_key === 'payout-audit-direct');
  assert.equal(payout.outsideCommitment, true);
  assert.equal(payout.overdue, false, 'doing it would route around the commitment one level up');
});

test('an overdue criterion of the commitment itself parks new lanes', () => {
  const later = new Date('2026-09-30T09:00:00Z');
  const proposal = { ...GOOD_PROPOSAL, killCriteria: [{ state: 'one paid customer', date: '2026-11-01' }] };
  const result = evaluateNewLane({ proposal, streams: [], commitment: COMMITMENT, now: later });
  const debt = result.reasons.find(r => r.filter === 'human-step-debt');
  assert.equal(debt.verdict, GUARD_VERDICT.PARK);
  assert.match(debt.why, /commitment's own step/);
});

test('a human step with no stated cost is never treated as cheap', () => {
  const unknownCost = [{ ...STREAMS[0], test_cost_hours: null }];
  const [item] = humanStepDebt({ streams: unknownCost, now: NOW });
  assert.equal(item.cheap, false);
  assert.equal(item.overdue, false);
});

test('BLOCKED human lanes count as primary load, DISPROVEN lanes count as nothing', () => {
  const load = laneLoad({ streams: STREAMS });
  assert.deepEqual(load.primary.sort(), ['github-paid-bounties', 'payout-audit-direct']);
  assert.deepEqual(load.background, ['ephemeral-attention-dataset']);
  assert.equal(load.overPrimary, 2 - DEFAULT_LIMITS.maxPrimaryLanes);
});

test('the WIP limit parks a lane when its slot is full, and replacing a disproven lane frees it', () => {
  const full = evaluateNewLane({ proposal: GOOD_PROPOSAL, streams: STREAMS, now: NOW });
  assert.equal(verdictOf(full, 'wip-limit'), GUARD_VERDICT.PARK);

  const replacing = { ...GOOD_PROPOSAL, replaces: 'agent-task-boards' };
  assert.equal(verdictOf(evaluateNewLane({ proposal: replacing, streams: STREAMS, now: NOW }), 'wip-limit'),
    GUARD_VERDICT.ADMIT);
});

test('replacing a lane that is not disproven does not free a slot', () => {
  const sneaky = { ...GOOD_PROPOSAL, replaces: 'ephemeral-attention-dataset' };
  assert.equal(verdictOf(evaluateNewLane({ proposal: sneaky, streams: STREAMS, now: NOW }), 'wip-limit'),
    GUARD_VERDICT.PARK);
});

test('an active commitment parks lanes outside it but not the committed lane itself', () => {
  const outside = evaluateNewLane({ proposal: GOOD_PROPOSAL, commitment: COMMITMENT, now: NOW });
  assert.equal(verdictOf(outside, 'commitment-window'), GUARD_VERDICT.PARK);

  const inside = { ...GOOD_PROPOSAL, stream_key: 'self-serve-scanner' };
  assert.equal(verdictOf(evaluateNewLane({ proposal: inside, commitment: COMMITMENT, now: NOW }), 'commitment-window'),
    GUARD_VERDICT.ADMIT);
});

test('a killed commitment no longer parks anything', () => {
  const killed = { ...COMMITMENT, status: 'killed' };
  assert.equal(verdictOf(evaluateNewLane({ proposal: GOOD_PROPOSAL, commitment: killed, now: NOW }), 'commitment-window'),
    GUARD_VERDICT.ADMIT);
});

test('a lane that runs on recurring relationships is parked unless explicitly overridden', () => {
  const section8 = { ...GOOD_PROPOSAL, ongoingRelationships: true };
  assert.equal(verdictOf(evaluateNewLane({ proposal: section8, now: NOW }), 'solo-fit'), GUARD_VERDICT.PARK);

  const chosen = { ...section8, soloFitOverride: 'decided to take on a co-director' };
  assert.equal(verdictOf(evaluateNewLane({ proposal: chosen, now: NOW }), 'solo-fit'), GUARD_VERDICT.ADMIT);
});

test('commitment status reports days left and criteria coming due', () => {
  const status = commitmentStatus({ commitment: COMMITMENT, now: NOW });
  assert.equal(status.state, 'active');
  assert.equal(status.dueCriteria.length, 1, 'the 2026-09-23 criterion is within the warning window');
  assert.equal(status.overdueCriteria.length, 0);
  assert.ok(status.daysRemaining > 80);
});

test('a criterion whose date has passed is reported overdue', () => {
  const later = new Date('2026-09-30T09:00:00Z');
  const status = commitmentStatus({ commitment: COMMITMENT, now: later });
  assert.equal(status.overdueCriteria.length, 1);
});

test('a commitment with no consequence, no size, or no exit is invalid', () => {
  const problems = validateCommitment({
    ...COMMITMENT,
    killCriteria: [{ date: '2026-10-01', state: 'something' }],
    ifThen: [{ if: 'idea', then: 'park' }]
  });
  assert.ok(problems.some(p => /ifMissed/.test(p)));
  assert.ok(problems.some(p => /minutes/.test(p)));
  assert.ok(validateCommitment({ ...COMMITMENT, killCriteria: [] }).some(p => /killCriteria/.test(p)));
});

// Guards the real file, not a fixture: a commitment that silently fails to parse
// is a commitment that silently stops parking anything.
test('data/operator-commitment.json is a valid commitment', async () => {
  const commitment = JSON.parse(await readFile('data/operator-commitment.json', 'utf8'));
  assert.deepEqual(validateCommitment(commitment), []);
});
