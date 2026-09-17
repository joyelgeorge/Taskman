/**
 * The Bridge — between stochastic plan generation and deterministic rails.
 *
 * An LLM plan is a proposal, never an instruction. This compiles a proposal into
 * a rigid DAG or rejects it with diagnostics the generator can act on: unknown
 * tool, missing dependency, cycle. Nothing unvalidated reaches a rail.
 *
 * Added beyond the original spec: shadow execution returns a READABLE EFFECT
 * SUMMARY rather than a pass/fail. A human asked to approve "the plan ran clean"
 * will rubber-stamp it; a human shown "this will send to 3 strangers and charge
 * $5" is making an actual decision. The gate is only as good as what it shows.
 */
import { validateDag, topoSort } from '../jobs/dag.js';

/** Compile a proposed plan into a validated DAG, or return diagnostics. */
export function compilePlanToDag(plan = {}, { registry = {} } = {}) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const diagnostics = [];
  const ids = steps.map(s => s.id);

  for (const s of steps) {
    if (!s.id) diagnostics.push('a step is missing an id');
    if (!registry[s.tool]) diagnostics.push(`step "${s.id}" calls "${s.tool}", which is not a registered capability`);
    for (const dep of s.dependsOn || []) {
      if (!ids.includes(dep)) diagnostics.push(`step "${s.id}" depends on "${dep}", which is not a step in this plan`);
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics };

  const dag = {};
  for (const s of steps) {
    dag[s.id] = { tool: s.tool, dependsOn: s.dependsOn || [], args: s.args || {}, run: async () => null };
  }

  const structural = validateDag(dag);
  if (!structural.ok) return { ok: false, diagnostics: [structural.error] };

  return { ok: true, dag };
}

/**
 * Run the plan against reality WITHOUT mutating anything: non-mutating steps
 * execute for real (so their output informs the plan), mutating steps are
 * withheld and merely described.
 */
export async function shadowExecute(dag = {}, { registry = {}, impls = {} } = {}) {
  const ran = [], withheld = [], results = {};
  for (const wave of topoSort(dag)) {
    for (const name of wave) {
      const tool = dag[name].tool;
      if (registry[tool]?.mutates) { withheld.push(name); continue; }
      try {
        results[name] = impls[tool] ? await impls[tool](dag[name].args, results) : null;
        ran.push(name);
      } catch (e) {
        return { ran, withheld, results, failed: name, error: String(e.message) };
      }
    }
  }
  return { ran, withheld, results };
}

/** Say, in plain language, what this plan WOULD do if approved. */
export function describeEffects(dag = {}, { registry = {} } = {}) {
  const summary = [], highConsequence = [];
  for (const [name, node] of Object.entries(dag)) {
    const cap = registry[node.tool] || {};
    if (cap.highConsequence) {
      highConsequence.push(name);
      summary.push(`${name}: will ${node.tool} — high consequence, needs your approval`);
    } else if (cap.mutates) {
      summary.push(`${name}: will ${node.tool} — changes state`);
    } else {
      summary.push(`${name}: ${node.tool} — read-only`);
    }
  }
  return { summary, highConsequence, requiresApproval: highConsequence.length > 0 };
}
