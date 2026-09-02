import { sharedReasoningEngine } from '../reasoning-engine.js';

/**
 * Plans the next executable step for a candidate that already reached
 * execution_queue. Schema validation only checks the plan's shape (steps is an
 * array, actionSummary is a string) — it cannot tell whether a step calls for a
 * capability the system does not actually have, which is exactly the kind of
 * plausible-sounding fabrication a model produces under this prompt. The
 * post-condition checks the plan against the real capability registry.
 */
export function planReferencesOnlyAvailableCapabilities(data, availableCapabilities = {}) {
  if (!Array.isArray(data?.steps)) return { ok: false, reason: 'steps is not an array' };

  // capabilitySnapshot() (orchestration-profiles.js) returns a { name: boolean }
  // map. Accept a plain array too, for callers that just have a list of names.
  const available = Array.isArray(availableCapabilities)
    ? new Set(availableCapabilities)
    : new Set(Object.entries(availableCapabilities).filter(([, enabled]) => enabled).map(([name]) => name));

  for (const step of data.steps) {
    if (step?.capability && !available.has(step.capability)) {
      return { ok: false, reason: `step references unavailable capability "${step.capability}"` };
    }
  }
  const adapters = Array.isArray(data?.requiredAdapters) ? data.requiredAdapters : [];
  if (adapters.length && !data.isBlocked && !adapters.every(a => typeof a === 'string' && a.trim())) {
    return { ok: false, reason: 'requiredAdapters contains a non-string or blank entry' };
  }
  return { ok: true };
}

/**
 * Produces an execution plan the caller may act on, or a rejection if the model
 * output is malformed or references a capability the system cannot actually
 * fulfil. The executor is never handed a plan that failed this check — a worker
 * that receives { ok: false } proceeds without AI assistance, exactly as it did
 * before this transform existed, rather than trusting a plan that lied about
 * what the system can do.
 */
export async function runExecutionPlan({ candidate, availableCapabilities = [], mockProvider = null }) {
  const result = await sharedReasoningEngine.planExecution({ candidate, availableCapabilities, mockProvider });
  if (!result.ok) return { ok: false, transform: 'execution-plan', error: result.error };

  const verdict = planReferencesOnlyAvailableCapabilities(result.data, availableCapabilities);
  if (!verdict.ok) {
    return { ok: false, transform: 'execution-plan', error: `post-condition failed: ${verdict.reason}`, rejectedData: result.data };
  }

  return { ok: true, transform: 'execution-plan', data: result.data };
}
