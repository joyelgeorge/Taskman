export const MONEY_STATES = [
  'DISCOVERED','QUALIFIED','VALIDATED','EXECUTABLE','SETUP_REQUIRED','READY','RUNNING','VALUE_CREATED','MONEY_EVENT','REPEATABLE'
];

const clamp = n => Math.max(0, Math.min(1, Number(n || 0)));

export function scoreGap(gap = {}) {
  const positive =
      0.28 * clamp(gap.moneyProgress)
    + 0.20 * clamp(gap.executability)
    + 0.16 * clamp(gap.informationGain)
    + 0.12 * clamp(gap.probabilityOfSuccess)
    + 0.10 * clamp(gap.reusability)
    + 0.08 * clamp(gap.urgency)
    + 0.06 * clamp(gap.reversibility);

  const negative =
      0.12 * clamp(gap.setupBurden)
    + 0.10 * clamp(gap.monetaryCost)
    + 0.08 * clamp(gap.latency)
    + 0.10 * clamp(gap.unvalidatedUncertainty);

  return Number((positive - negative).toFixed(4));
}

export function scoreOpportunity(o = {}) {
  const numerator =
    Math.max(0.01, Number(o.expectedValue || 0)) *
    Math.max(0.01, clamp(o.probabilityExecutable)) *
    Math.max(0.01, Number(o.recurrenceMultiplier || 1)) *
    Math.max(0.01, clamp(o.automationFraction)) *
    Math.max(0.01, clamp(o.attributionClarity));

  const denominator =
    1 + Math.max(0, Number(o.setupCost || 0)) +
    Math.max(0, Number(o.timeToMoney || 0)) +
    Math.max(0, Number(o.operationalFriction || 0)) +
    Math.max(0, Number(o.risk || 0));

  return Number((numerator / denominator).toFixed(4));
}

export function rankGaps(gaps = []) {
  return gaps
    .filter(g => !g.resolved && !g.rejected)
    .map(g => ({ ...g, score: scoreGap(g) }))
    .sort((a, b) => b.score - a.score);
}

export function chooseNextGap(gaps = []) {
  return rankGaps(gaps)[0] || null;
}

export function buildRelevantContext({ goal, constraints = [], bestPath, gap, facts = [], rejectedPaths = [] }) {
  const tags = new Set([...(gap?.tags || []), ...(gap?.requiredCapabilities || [])]);
  const relevantFacts = facts.filter(f => {
    if (!tags.size) return f.priority === 'high';
    return (f.tags || []).some(tag => tags.has(tag)) || f.priority === 'high';
  }).slice(0, 20);

  return {
    goal,
    constraints,
    currentBestPath: bestPath || null,
    currentGap: gap || null,
    relevantFacts,
    rejectedPaths: rejectedPaths.slice(-15),
    instruction: 'Resolve only the current gap. Return evidence, confidence, what changed, and the smallest next step.'
  };
}

export function detectLoop(history = [], strategyId) {
  const recent = history.filter(x => x.strategyId === strategyId).slice(-4);
  if (recent.length < 3) return false;
  const noProgress = recent.filter(x => Number(x.moneyProgressDelta || 0) <= 0 && Number(x.evidenceGain || 0) <= 0.05);
  return noProgress.length >= 3;
}

export function createBrainDecision(input) {
  const rankedOpportunities = (input.opportunities || [])
    .map(o => ({ ...o, score: scoreOpportunity(o) }))
    .sort((a, b) => b.score - a.score);

  const opportunity = rankedOpportunities[0] || null;
  const gaps = opportunity?.gaps || input.gaps || [];
  const nextGap = chooseNextGap(gaps);

  if (!opportunity && !nextGap) {
    return { action: 'DISCOVER', reason: 'No qualified opportunity or unresolved gap exists.' };
  }

  if (nextGap?.requiresUser) {
    return {
      action: 'WAITING_USER',
      opportunityId: opportunity?.id || null,
      nextGap,
      userAction: nextGap.userAction || 'Provide the smallest missing permission or setup step.'
    };
  }

  return {
    action: 'RESOLVE_GAP',
    opportunityId: opportunity?.id || null,
    opportunityScore: opportunity?.score || null,
    nextGap,
    contextPacket: buildRelevantContext({
      goal: input.goal,
      constraints: input.constraints,
      bestPath: opportunity?.bestPath || input.bestPath,
      gap: nextGap,
      facts: input.facts,
      rejectedPaths: input.rejectedPaths
    }),
    requestedCapabilities: nextGap?.requiredCapabilities || ['reasoning'],
    successCondition: nextGap?.successCondition || 'The gap is resolved with evidence strong enough to advance the candidate.'
  };
}
