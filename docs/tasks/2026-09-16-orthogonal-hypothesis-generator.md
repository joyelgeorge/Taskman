---
status: open
priority: P2
level: 4
opened: 2026-09-16
---

# The Creative Engine: Orthogonal candidate generator with symbolic pruning

**Priority: P2. Level 4 (Exploration Space).**

## What

Implement an orthogonal candidate generator for problem decomposition and target scouting that breaks median consensus prompting.

Instead of running a single heuristic query or linear LLM scan, the Creative Engine executes parallel generation pipelines with contrasting system constraints:
- **Pipeline A (Adversarial Taint):** Traces data flow aggressively from untrusted user inputs to critical sinks.
- **Pipeline B (Defensive Assumption):** Searches explicitly for middleware, auth wrappers, and framework route guards (e.g. `requireSuperAdmin()`).
- **Pipeline C (Economic Context):** Evaluates whether the target exhibits real business indicators (Stripe Connect, paid tiers, active commits) vs toy/learning projects.

Symbolic evaluators (AST checks, route graph linters, dependency checkers) prune hallucinated or contradictory candidate hypotheses before they are enqueued.

## Why it matters

Standard LLM prompting defaults to median consensus and superficial pattern matching. In the vibe-coded app sweep, naive heuristic checks produced a 100% false-positive rate on admin route authentication because delegated helpers (`requireSuperAdmin`) were missed. Running parallel, contrasting perspectives with deterministic symbolic pruning filters out false alarms before they ever reach human review or outreach.

## Built 2026-09-17

Core built and mutation-tested. See the commit; the module is the first step, wiring it into the live sweep/runner is the remainder.

## Done looks like

1. Discovery drones can output competing hypothesis candidates tagged with the generating perspective.
2. A symbolic evaluator module prunes candidates whose findings are refuted by static AST analysis.
3. Only pruned, non-contradictory candidates are promoted from the raw exploration space into `candidate_queue`.
