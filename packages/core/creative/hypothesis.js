/**
 * The Creative Engine — orthogonal candidate generation with symbolic pruning.
 *
 * Standard prompting collapses to median consensus: one heuristic, one answer,
 * and no way to see its own blind spot. Measured cost (2026-09-15): a single
 * "does this file contain an auth word" heuristic reported 6 of 6 admin routes
 * unauthenticated; every one called requireSuperAdmin() through an imported
 * helper. A contrasting perspective that went looking FOR guards would have
 * caught it instantly.
 *
 * Three ideas here, two of which the original spec did not have:
 *
 *  1. Contrasting pipelines (in the spec) — adversarial, defensive, economic,
 *     plus REACHABILITY and TEMPORAL, added because both cost us real findings:
 *     flyrpro's "command injection" was in a local script no request reaches, and
 *     Supabase now auto-revokes leaked keys, so a finding decays.
 *
 *  2. Symbolic pruning (in the spec) — deterministic evidence (AST, route graph)
 *     kills a hallucinated claim before a human ever sees it.
 *
 *  3. DISAGREEMENT AS SIGNAL (new) — when two perspectives make opposing claims
 *     about the same target, that is not noise to average away. It is the most
 *     informative state on the board, and it is exactly where the admin-route bug
 *     lived. Contested candidates are never auto-promoted; they are routed to a
 *     human, which is the cheapest possible place to spend attention.
 */

export const PERSPECTIVE = Object.freeze({
  ADVERSARIAL: 'adversarial',   // taint: untrusted input -> critical sink
  DEFENSIVE: 'defensive',       // look FOR guards, middleware, auth wrappers
  ECONOMIC: 'economic',         // is this a real business or a toy project
  REACHABILITY: 'reachability', // is the vulnerable code actually reachable
  TEMPORAL: 'temporal'          // is the finding still live, or already decayed
});

export const VERDICT_STATE = Object.freeze({
  CORROBORATED: 'corroborated',   // >1 perspective, no opposition
  CONTESTED: 'contested',         // perspectives disagree — needs a human
  SINGLE_SOURCE: 'single_source', // one perspective, unopposed
  REFUTED: 'refuted'              // symbolic evidence killed it
});

/** Claims that directly oppose one another about the same target. */
const OPPOSES = Object.freeze({
  'unauthenticated-admin-route': ['guarded-by-helper', 'guarded-by-middleware'],
  'guarded-by-helper': ['unauthenticated-admin-route'],
  'guarded-by-middleware': ['unauthenticated-admin-route'],
  'exposed-secret': ['secret-is-anon-key', 'secret-already-rotated'],
  'secret-is-anon-key': ['exposed-secret'],
  'secret-already-rotated': ['exposed-secret']
});

/** Run each pipeline over a target; every candidate is tagged with its origin. */
export function generateCandidates(target, { pipelines = {} } = {}) {
  const out = [];
  for (const [perspective, run] of Object.entries(pipelines)) {
    let produced = [];
    try { produced = run(target) || []; } catch { produced = []; }  // a broken pipeline must not sink the rest
    for (const c of produced) out.push({ ...c, perspective: c.perspective || perspective, target: c.target || target });
  }
  return out;
}

/**
 * Deterministic refutation. `evidence` maps a target to facts a symbolic checker
 * established (AST, route graph). Facts beat claims — always.
 */
export function pruneRefuted(candidates = [], evidence = {}) {
  return candidates.filter(c => {
    const facts = evidence[c.target];
    if (!facts) return true;
    if (c.claim === 'unauthenticated-admin-route' && facts.callsGuardHelper) return false;
    if (c.claim === 'exposed-secret' && facts.keyRole === 'anon') return false;
    if (c.claim === 'exposed-secret' && facts.rotatedAt) return false;
    if (facts.unreachable) return false;
    return true;
  });
}

/**
 * Score by cross-perspective agreement, and surface disagreement rather than
 * burying it. One entry per (target, claim) group, plus a CONTESTED entry for any
 * target where perspectives oppose each other.
 */
export function scoreByAgreement(candidates = []) {
  const byTarget = new Map();
  for (const c of candidates) {
    if (!byTarget.has(c.target)) byTarget.set(c.target, []);
    byTarget.get(c.target).push(c);
  }

  const scored = [];
  for (const [target, group] of byTarget) {
    const claims = [...new Set(group.map(c => c.claim))];
    const opposed = claims.some(a => claims.some(b => (OPPOSES[a] || []).includes(b)));

    if (opposed) {
      scored.push({
        target, state: VERDICT_STATE.CONTESTED,
        claims, agreement: 0,
        perspectives: [...new Set(group.map(c => c.perspective))],
        why: 'perspectives disagree about this target — a human decides, cheaply, before anyone is contacted'
      });
      continue;
    }

    for (const claim of claims) {
      const backing = group.filter(c => c.claim === claim);
      const perspectives = [...new Set(backing.map(c => c.perspective))];
      scored.push({
        target, claim,
        agreement: perspectives.length,
        perspectives,
        confidence: Math.max(...backing.map(c => c.confidence ?? 0.5)),
        state: perspectives.length > 1 ? VERDICT_STATE.CORROBORATED : VERDICT_STATE.SINGLE_SOURCE
      });
    }
  }
  return scored;
}

/** Only non-contested candidates leave the exploration space. */
export function promote(scored = []) {
  return scored.filter(s => s.state === VERDICT_STATE.CORROBORATED || s.state === VERDICT_STATE.SINGLE_SOURCE);
}
