import { databaseEnabled, query } from './db.js';
import { listScenarios } from './scenario-store.js';
import { scoreScenario } from './scenario-engine.js';
import { getKnowledgeSnapshot, ingestStructuredLearning } from './knowledge-store.js';
import { runWithFallback } from './providers.js';
import { buildLearningPrompt, parseLearningEnvelope, validateLearningEnvelope } from './structured-learning.js';
import { stableErrorCode } from './errors.js';

function activeGaps(scenario, knowledge) {
  const resolved = new Set((knowledge.resolvedGaps || []).map(e => e.value?.gap || e.gap));
  const rejected = new Set((knowledge.rejectedPaths || []).map(e => e.value?.gap || e.value?.summary || e.summary));
  const seeded = Array.isArray(scenario.next_gaps) ? scenario.next_gaps : [];
  const learned = (knowledge.openGaps || []).map(e => e.value?.gap || e.gap).filter(Boolean);
  return [...new Set([...learned, ...seeded])].filter(g => !resolved.has(g) && !rejected.has(g));
}

function dynamicScenario(scenario, knowledge) {
  return {
    ...scenario,
    next_gaps: activeGaps(scenario, knowledge),
    money_event: scenario.money_event || ((knowledge.moneyEvents || []).length ? 'observed' : null),
    evidence_strength: Math.max(Number(scenario.evidence_strength ?? 0.5),
      Math.min(1, 0.45 + (knowledge.knownFacts?.length || 0) * 0.025))
  };
}

export async function getBrainState() {
  const scenarios = await listScenarios();
  const evaluated = [];
  for (const scenario of scenarios) {
    const knowledge = await getKnowledgeSnapshot({ scenarioId: scenario.id });
    const current = dynamicScenario(scenario, knowledge);
    evaluated.push({
      scenario: current,
      knowledge,
      ranking: scoreScenario(current)
    });
  }

  evaluated.sort((a, b) => b.ranking.score - a.ranking.score);
  const candidate = evaluated.find(x => x.scenario.status !== 'rejected' && x.scenario.next_gaps?.length);
  return {
    evaluated,
    nextAction: candidate ? {
      type: 'resolve_gap',
      scenarioId: candidate.scenario.id,
      scenarioName: candidate.scenario.name,
      scenarioScore: candidate.ranking.score,
      gap: candidate.scenario.next_gaps[0]
    } : {
      type: 'discover_new_scenario',
      reason: 'No non-rejected scenario currently has an unresolved gap.'
    }
  };
}

async function createCycle(cycle) {
  if (!databaseEnabled) return cycle;
  await query(
    `INSERT INTO brain_cycles (id, scenario_id, action, gap, scenario_score, status, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [cycle.id, cycle.scenarioId || null, cycle.action, cycle.gap || null, cycle.scenarioScore || null, cycle.status, cycle.startedAt]
  );
  return cycle;
}

async function finishCycle(cycle) {
  if (!databaseEnabled) return cycle;
  await query(
    `UPDATE brain_cycles SET status=$2, provider_id=$3, model_id=$4, input_tokens=$5,
       output_tokens=$6, result=$7::jsonb, error=$8, finished_at=$9 WHERE id=$1`,
    [cycle.id, cycle.status, cycle.provider || null, cycle.model || null,
     cycle.inputTokens || 0, cycle.outputTokens || 0, JSON.stringify(cycle.result || null), cycle.error || null, cycle.finishedAt]
  );
  return cycle;
}

function compactScenarioContext(scenario, knowledge, gap) {
  return {
    objective: scenario.goal,
    scenario: scenario.name,
    currentGap: gap,
    knownFacts: (knowledge.knownFacts || []).slice(-10).map(e => e.value || e),
    assumptions: (knowledge.activeAssumptions || []).slice(-5).map(e => e.value || e),
    rejectedPaths: (knowledge.rejectedPaths || []).slice(-10).map(e => e.value || e),
    moneyEvents: (knowledge.moneyEvents || []).slice(-5).map(e => e.value || e),
    priorFuturePath: knowledge.latestFuturePath?.value || null,
    constraints: scenario.constraints || scenario.global_constraints || []
  };
}

export async function executeBrainCycle(reason = 'manual', { signal } = {}) {
  const brain = await getBrainState();
  const action = brain.nextAction;
  const cycle = {
    id: crypto.randomUUID(),
    action: action.type,
    scenarioId: action.scenarioId || null,
    scenarioScore: action.scenarioScore || null,
    gap: action.gap || null,
    reason,
    status: 'running',
    startedAt: new Date().toISOString()
  };
  await createCycle(cycle);

  try {
    if (action.type !== 'resolve_gap') {
      cycle.status = 'no_action';
      cycle.result = action;
    } else {
      const selected = brain.evaluated.find(x => x.scenario.id === action.scenarioId);
      const context = compactScenarioContext(selected.scenario, selected.knowledge, action.gap);
      const objective = `Scenario: ${selected.scenario.name}. Goal: ${selected.scenario.goal}. Resolve this gap only: ${action.gap}`;
      const prompt = buildLearningPrompt({ objective, context });
      const response = await runWithFallback(prompt, { signal });
      const envelope = validateLearningEnvelope(parseLearningEnvelope(response.text));

      cycle.status = 'succeeded';
      cycle.provider = response.provider;
      cycle.model = response.model;
      cycle.inputTokens = response.inputTokens;
      cycle.outputTokens = response.outputTokens;
      cycle.result = { answer: envelope.answer, events: envelope.events };

      await ingestStructuredLearning({
        scenarioId: action.scenarioId,
        taskId: null,
        runId: null,
        envelope
      });
    }
  } catch (error) {
    cycle.status = 'failed';
    cycle.error = stableErrorCode(error, 'PROVIDER_UNAVAILABLE');
  }

  cycle.finishedAt = new Date().toISOString();
  await finishCycle(cycle);
  return { cycle, brainAfter: await getBrainState() };
}

export async function listBrainCycles(limit = 30) {
  if (!databaseEnabled) return [];
  const result = await query('SELECT * FROM brain_cycles ORDER BY started_at DESC LIMIT $1', [limit]);
  return result.rows;
}
