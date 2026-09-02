import { sharedReasoningEngine } from '../reasoning-engine.js';

/**
 * The only place a model call in this codebase is allowed to happen.
 *
 * Discovery may never call a model — see src/workers/discover.js and
 * docs/TARGET_DESIGN.md §1: asking an LLM to originate a candidate returns
 * whatever every other holder of that model gets, and the rejection log in
 * data/money-flow-runs already shows this happening ("an incumbent already does
 * this" on nearly every candidate). A transform may only ever act on a candidate
 * that already exists, narrowing or checking it — never inventing one.
 *
 * Every transform here has three layers of defense against a bad model output
 * reaching the pipeline, in order:
 *   1. JSON parses at all (reasoning-engine.js)
 *   2. the shape matches a declared schema (reasoning-schemas.js)
 *   3. a deterministic post-condition specific to THIS transform holds —
 *      something schema validation cannot check because it depends on the
 *      system's own state (an available capability, an evidence reference that
 *      is not just a restatement of the gate name), not on the shape of JSON.
 * A transform has no side-effecting tools. It returns { ok, data } or
 * { ok: false, error }; the caller decides what happens next.
 */
export async function runTransform({
  name,
  prompt,
  schemaName,
  postCondition = null,
  mockProvider = null
}) {
  if (!name) throw new Error('transform name is required');
  if (!prompt) throw new Error('transform prompt is required');

  const result = await sharedReasoningEngine.reason({ prompt, schemaName, mockProvider });
  if (!result.ok) return { ...result, transform: name };

  if (postCondition) {
    const verdict = postCondition(result.data);
    if (!verdict || verdict.ok !== true) {
      return {
        ok: false,
        transform: name,
        error: `post-condition failed: ${verdict?.reason || 'unspecified'}`,
        rejectedData: result.data
      };
    }
  }

  return { ...result, transform: name };
}
