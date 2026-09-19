/**
 * Operator guards — filters against the operator's own failure modes.
 *
 * Everything else in this repository guards against the market: traps, false
 * positives, unverified leads, charging without verification. Nothing guarded
 * against the pattern the stores themselves record:
 *
 *   - new lanes open whenever the nearest lane needs a human step
 *     (income_streams, 2026-09-05..10: four machine lanes TESTING, four human
 *     lanes BLOCKED, zero settlements)
 *   - the cheapest path to money waits on an hour of operator work
 *     (payout-audit-direct: "blocked only on a payment account")
 *   - capital-at-risk lanes enter the board beside zero-capital ones
 *     (defi-flashloan-arbitrage next to payout reconciliation)
 *
 * The research behind each filter is in docs/OPERATOR-GUARDS.md. This module is
 * pure: no database, no clock except the `now` it is given, so every verdict is
 * reproducible and every filter can be proven by removing it.
 */

export const GUARD_VERDICT = Object.freeze({
  ADMIT: 'admit',   // may enter TESTING
  PARK: 'park',     // sound but ill-timed: parking lot, revisit at commitment review
  REJECT: 'reject'  // incomplete or unsafe as written: fix the proposal first
});

const SEVERITY = { admit: 0, park: 1, reject: 2 };

export const DEFAULT_LIMITS = Object.freeze({
  // Weinberg's switching heuristic: a second concurrent project costs ~20% of
  // total effort, and the loss grows with each one after. One lane that needs
  // the operator, one that accrues on its own.
  maxPrimaryLanes: 1,
  maxBackgroundLanes: 1,
  // A human step at or under this many hours is cheap enough that waiting on it
  // is a choice, not a constraint.
  cheapHumanStepHours: 3,
  // After this many days a cheap human step is debt, and new lanes are parked
  // until it is paid.
  humanStepGraceDays: 2,
  // Lanes whose commitment review is this close get listed as due.
  reviewWarningDays: 7
});

const DAY = 86_400_000;

/**
 * Lanes where money is lost by participating, not just by failing to earn.
 * SEBI's FY25 study: ~91% of individual F&O traders lost money, a ratio that
 * has held between 89% and 93% since FY22. A solo builder has no edge there
 * that a sandbox cap does not already price.
 */
const CAPITAL_AT_RISK = /\b(f&o|futures|derivatives?|leverage[ds]?|margin trading|crypto\w*|bitcoin|btc|ethereum|defi|flash ?loans?|liquidation hunting|forex|(?:stock|options|intraday|swing|day|algo|algorithmic) trading|token rewards?|staking)\b/i;

/** True when a proposal puts the operator's own money at risk. An explicit false wins. */
export function isCapitalAtRisk(proposal = {}) {
  if (proposal.capitalAtRisk === true) return true;
  if (proposal.capitalAtRisk === false) return false;
  const text = [proposal.title, proposal.mechanism, proposal.requires].filter(Boolean).join(' ');
  return CAPITAL_AT_RISK.test(text);
}

function toTime(value) {
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

const ACTIVE_STATES = new Set(['TESTING', 'BLOCKED']);

/**
 * Lanes currently holding attention. A human-unblocked lane is primary even
 * while BLOCKED: waiting on the operator is still the operator's lane.
 */
export function laneLoad({ streams = [], limits = DEFAULT_LIMITS } = {}) {
  const active = streams.filter(s => ACTIVE_STATES.has(s.state));
  const primary = active.filter(s => s.unblocked_by === 'human').map(s => s.stream_key);
  const background = active.filter(s => s.unblocked_by !== 'human').map(s => s.stream_key);
  return {
    primary,
    background,
    overPrimary: Math.max(0, primary.length - limits.maxPrimaryLanes),
    overBackground: Math.max(0, background.length - limits.maxBackgroundLanes)
  };
}

/**
 * Cheap human steps that have been waiting. Sorted so the first item is the one
 * to do next: overdue before not, cheapest before dearest, oldest before newest.
 * A step with no stated cost is listed but never called cheap — an unknown cost
 * is not a small one.
 */
export function humanStepDebt({
  streams = [], now = new Date(), limits = DEFAULT_LIMITS, commitment = null
} = {}) {
  const nowT = toTime(now);
  const status = commitment ? commitmentStatus({ commitment, now, limits }) : null;
  const committed = status?.state === 'active'
    ? new Set([status.primary, ...(status.background || [])]) : null;
  return streams
    .filter(s => s.state === 'BLOCKED' && s.unblocked_by === 'human')
    .map(s => {
      const since = toTime(s.updated_at) ?? toTime(s.created_at);
      const ageDays = since === null ? null : Math.floor((nowT - since) / DAY);
      const costHours = s.test_cost_hours === null || s.test_cost_hours === undefined
        ? null : Number(s.test_cost_hours);
      const cheap = costHours !== null && costHours <= limits.cheapHumanStepHours;
      // Under an active commitment, a human step on some other lane is not debt
      // to pay first. It is a lane to park or disprove: doing it would be the
      // same routing-around, one level up.
      const outsideCommitment = committed ? !committed.has(s.stream_key) : false;
      return {
        stream_key: s.stream_key,
        title: s.title,
        next_action: s.next_action ?? null,
        costHours,
        ageDays,
        cheap,
        outsideCommitment,
        overdue: !outsideCommitment && cheap && ageDays !== null && ageDays > limits.humanStepGraceDays
      };
    })
    .sort((a, b) =>
      (Number(b.overdue) - Number(a.overdue))
      || ((a.costHours ?? Infinity) - (b.costHours ?? Infinity))
      || ((b.ageDays ?? -1) - (a.ageDays ?? -1)));
}

/** Where the operator's commitment stands on a date. Never guesses a missing field. */
export function commitmentStatus({ commitment, now = new Date(), limits = DEFAULT_LIMITS } = {}) {
  if (!commitment) return { state: 'none', problems: ['no commitment recorded'] };
  const problems = validateCommitment(commitment);
  if (problems.length) return { state: 'invalid', problems };

  const nowT = toTime(now);
  const start = toTime(commitment.committedOn);
  const end = toTime(commitment.reviewOn);
  const state = commitment.status !== 'active' ? commitment.status
    : nowT < start ? 'before'
    : nowT > end + DAY ? 'ended'
    : 'active';

  const criteria = commitment.killCriteria.map(k => ({ ...k, t: toTime(k.date) }));
  return {
    state,
    primary: commitment.primary,
    background: commitment.background ?? [],
    daysElapsed: Math.max(0, Math.floor((nowT - start) / DAY)),
    daysRemaining: Math.max(0, Math.ceil((end - nowT) / DAY)),
    overdueCriteria: criteria.filter(k => k.t < nowT - DAY).map(({ t, ...k }) => k),
    dueCriteria: criteria
      .filter(k => k.t >= nowT - DAY && k.t <= nowT + limits.reviewWarningDays * DAY)
      .map(({ t, ...k }) => k),
    problems: []
  };
}

const COMMITMENT_STATUSES = new Set(['active', 'completed', 'killed']);

/** Problems with a commitment record, as strings. Empty means usable. */
export function validateCommitment(c = {}) {
  const problems = [];
  if (!c.primary) problems.push('primary: name the one lane this commitment is for');
  if (toTime(c.committedOn) === null) problems.push('committedOn: not a date');
  if (toTime(c.reviewOn) === null) problems.push('reviewOn: not a date');
  if (toTime(c.committedOn) !== null && toTime(c.reviewOn) !== null && toTime(c.reviewOn) <= toTime(c.committedOn)) {
    problems.push('reviewOn: must be after committedOn');
  }
  if (!COMMITMENT_STATUSES.has(c.status)) {
    problems.push(`status "${c.status ?? ''}" is not one of ${[...COMMITMENT_STATUSES].join(', ')}`);
  }
  if (!Array.isArray(c.killCriteria) || !c.killCriteria.length) {
    problems.push('killCriteria: at least one state-and-date exit is required');
  } else {
    c.killCriteria.forEach((k, i) => {
      if (!k?.state) problems.push(`killCriteria[${i}]: no state — what must be true`);
      if (toTime(k?.date) === null) problems.push(`killCriteria[${i}]: no date — by when`);
      if (!k?.ifMissed) problems.push(`killCriteria[${i}]: no ifMissed — a criterion with no consequence is a wish`);
    });
  }
  if (!Array.isArray(c.ifThen) || !c.ifThen.length) {
    problems.push('ifThen: at least one if-then plan is required');
  } else {
    c.ifThen.forEach((p, i) => {
      if (!p?.if || !p?.then) problems.push(`ifThen[${i}]: needs both a cue (if) and an action (then)`);
      if (!Number.isFinite(p?.minutes) || p.minutes <= 0) {
        problems.push(`ifThen[${i}]: minutes must be a positive number — a plan with no size never starts`);
      }
    });
  }
  return problems;
}

function finding(filter, verdict, why) {
  return { filter, verdict, why };
}

/**
 * The intake filter. Every proposed lane passes all seven, and the overall
 * verdict is the most severe one any filter returned. Filters never short
 * circuit: a proposal that fails three ways should hear about all three.
 */
export function evaluateNewLane({
  proposal = {}, streams = [], commitment = null, now = new Date(), limits = DEFAULT_LIMITS
} = {}) {
  const reasons = [];
  const nowT = toTime(now);
  const byKey = new Map(streams.map(s => [s.stream_key, s]));

  // 1. Kill criteria — Annie Duke's states and dates. A lane with no exit is
  //    the most expensive kind, because it never stops costing.
  const kills = Array.isArray(proposal.killCriteria) ? proposal.killCriteria : [];
  const usable = kills.filter(k => k?.state && toTime(k?.date) !== null && toTime(k.date) > nowT);
  reasons.push(usable.length
    ? finding('kill-criteria', GUARD_VERDICT.ADMIT, `${usable.length} future state-and-date exit(s)`)
    : finding('kill-criteria', GUARD_VERDICT.REJECT,
      'no future kill criterion with both a state and a date: write "if by <date> not <state>, quit" first'));

  // 2. Paying demand — someone already pays for this, somewhere. Startup Genome:
  //    building ahead of validated demand is the most common way to fail.
  reasons.push(proposal.payingDemandEvidence
    ? finding('paying-demand', GUARD_VERDICT.ADMIT, `evidence: ${proposal.payingDemandEvidence}`)
    : finding('paying-demand', GUARD_VERDICT.PARK,
      'no evidence of anyone already paying for this: HYPOTHESIS only until one paying buyer is named'));

  // 3. Capital at risk.
  if (isCapitalAtRisk(proposal)) {
    const cap = Number(proposal.capitalCapInr);
    reasons.push(Number.isFinite(cap) && cap > 0
      ? finding('capital-risk', GUARD_VERDICT.PARK,
        `capital at risk, capped at ₹${cap}: sandbox only, never the primary lane, and never while a commitment is active`)
      : finding('capital-risk', GUARD_VERDICT.REJECT,
        'capital at risk with no capitalCapInr: set the most you will lose before anything else'));
  } else {
    reasons.push(finding('capital-risk', GUARD_VERDICT.ADMIT, 'no operator capital at risk'));
  }

  // 4. Human-step debt — the monkey before the pedestal.
  //    The commitment's own overdue criteria are debt too: they are usually the
  //    ignition steps of a lane that is not in income_streams yet.
  const debt = humanStepDebt({ streams, now, limits, commitment }).filter(d => d.overdue);
  const commitmentDebt = commitmentStatus({ commitment, now, limits }).overdueCriteria ?? [];
  if (commitmentDebt.length) {
    reasons.push(finding('human-step-debt', GUARD_VERDICT.PARK,
      `the commitment's own step is overdue since ${commitmentDebt[0].date}: "${commitmentDebt[0].state}". Opening a lane now routes around it.`));
  } else if (debt.length) {
    reasons.push(finding('human-step-debt', GUARD_VERDICT.PARK,
      `${debt.length} cheap human step(s) overdue. Do "${debt[0].title}" first (~${debt[0].costHours}h, waiting ${debt[0].ageDays}d). Opening a lane now routes around it.`));
  } else {
    reasons.push(finding('human-step-debt', GUARD_VERDICT.ADMIT, 'no overdue cheap human steps'));
  }

  // 5. WIP limit — replacing a disproven lane frees its slot.
  const load = laneLoad({ streams, limits });
  const replaced = proposal.replaces ? byKey.get(proposal.replaces) : null;
  const freesSlot = replaced?.state === 'DISPROVEN';
  const human = proposal.unblocked_by === 'human';
  const count = human ? load.primary.length : load.background.length;
  const max = human ? limits.maxPrimaryLanes : limits.maxBackgroundLanes;
  const kind = human ? 'primary' : 'background';
  reasons.push(count < max || freesSlot
    ? finding('wip-limit', GUARD_VERDICT.ADMIT,
      freesSlot ? `replaces disproven lane ${replaced.stream_key}` : `${count}/${max} ${kind} lanes in use`)
    : finding('wip-limit', GUARD_VERDICT.PARK,
      `${count}/${max} ${kind} lanes already active: finish, disprove, or park one before adding another`));

  // 6. Commitment window.
  const status = commitmentStatus({ commitment, now, limits });
  const inCommitment = status.state === 'active'
    && proposal.stream_key !== status.primary
    && !(status.background || []).includes(proposal.stream_key);
  reasons.push(inCommitment
    ? finding('commitment-window', GUARD_VERDICT.PARK,
      `committed to ${status.primary} for ${status.daysRemaining} more day(s): park until the review or until a kill criterion fires`)
    : finding('commitment-window', GUARD_VERDICT.ADMIT,
      status.state === 'active' ? 'part of the active commitment' : `commitment state: ${status.state}`));

  // 7. Solo fit — one-time ignition work is fine and expected; a lane that runs
  //    on recurring relationships contradicts the stated operating goal.
  if (proposal.ongoingRelationships === true && !proposal.soloFitOverride) {
    reasons.push(finding('solo-fit', GUARD_VERDICT.PARK,
      'operating it needs recurring relationships (partners, directors, meetings). Set soloFitOverride with a reason if that is now intended.'));
  } else {
    reasons.push(finding('solo-fit', GUARD_VERDICT.ADMIT,
      proposal.soloFitOverride ? `override: ${proposal.soloFitOverride}` : 'runs without recurring relationships'));
  }

  const verdict = reasons.reduce(
    (worst, r) => (SEVERITY[r.verdict] > SEVERITY[worst] ? r.verdict : worst),
    GUARD_VERDICT.ADMIT);
  return { verdict, reasons };
}
