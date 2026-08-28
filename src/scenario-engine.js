const clamp = n => Math.max(0, Math.min(1, Number(n) || 0));

export const STATUS_WEIGHT = {
  active: 1,
  building: 0.95,
  active_manual: 0.8,
  existing_asset_possible_revenue: 0.65,
  unvalidated: 0.35,
  rejected: 0
};

export function scoreScenario(s) {
  if (s.status === 'rejected') return { score: 0, reasons: ['rejected path'] };

  const evidence = clamp(s.evidence_strength ?? 0.5);
  const status = STATUS_WEIGHT[s.status] ?? 0.4;
  const hasMoneyEvent = Boolean(s.money_event || s.success_metric);
  const hasNextGaps = Array.isArray(s.next_gaps) && s.next_gaps.length > 0;
  const hasRepeatLoop = Boolean(s.repeatable_loop || s.core_loop || s.automation_opportunity);
  const structuredGoal = Boolean(s.goal);

  const score =
    0.28 * evidence +
    0.24 * status +
    0.18 * Number(hasMoneyEvent) +
    0.12 * Number(hasNextGaps) +
    0.10 * Number(hasRepeatLoop) +
    0.08 * Number(structuredGoal);

  return {
    score: Number(score.toFixed(4)),
    reasons: [
      `evidence=${evidence}`,
      `status=${status}`,
      hasMoneyEvent ? 'money-event-defined' : 'money-event-missing',
      hasNextGaps ? 'next-gaps-defined' : 'next-gaps-missing',
      hasRepeatLoop ? 'repeat-loop-present' : 'repeat-loop-missing'
    ]
  };
}

export function rankScenarios(db) {
  return (db.scenarios || [])
    .map(s => ({ ...s, ranking: scoreScenario(s) }))
    .sort((a, b) => b.ranking.score - a.ranking.score);
}

export function selectNextGap(scenario) {
  if (!scenario || scenario.status === 'rejected') return null;
  const gaps = scenario.next_gaps || [];
  if (!gaps.length) return null;
  return { scenarioId: scenario.id, gap: gaps[0], gapIndex: 0 };
}

export function buildMinimalContext(scenario, knowledge = {}) {
  const context = {
    objective: scenario.goal,
    status: scenario.status,
    currentBestPath: scenario.current_best_path || null,
    currentGap: selectNextGap(scenario)?.gap || null,
    constraints: knowledge.constraints || [],
    relevantFacts: knowledge.relevantFacts || [],
    rejectedPaths: knowledge.rejectedPaths || [],
    requiredOutput: 'Return only evidence or an action that resolves the current gap. Do not broaden the task.'
  };

  return Object.fromEntries(Object.entries(context).filter(([, value]) => {
    if (value == null) return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }));
}

export function applyEvidence(scenario, evidence) {
  const next = structuredClone(scenario);
  next.evidence_log = [...(next.evidence_log || []), evidence];

  if (evidence.type === 'rejection') {
    next.rejection_reasons = [...(next.rejection_reasons || []), evidence.summary];
    if (evidence.terminal === true) next.status = 'rejected';
  }

  if (evidence.type === 'gap_resolved' && Array.isArray(next.next_gaps)) {
    next.next_gaps = next.next_gaps.filter(g => g !== evidence.gap);
  }

  if (typeof evidence.confidence_delta === 'number') {
    next.evidence_strength = clamp((next.evidence_strength ?? 0.5) + evidence.confidence_delta);
  }

  next.updated_at = new Date().toISOString();
  return next;
}

export function chooseBrainAction(db) {
  const ranked = rankScenarios(db).filter(s => s.status !== 'rejected');
  for (const scenario of ranked) {
    const gap = selectNextGap(scenario);
    if (gap) {
      return {
        type: 'resolve_gap',
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        scenarioScore: scenario.ranking.score,
        gap: gap.gap
      };
    }
  }
  return { type: 'discover_new_scenario', reason: 'No active scenario has an unresolved structured gap.' };
}
