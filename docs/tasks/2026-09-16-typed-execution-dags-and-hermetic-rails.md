---
status: open
priority: P2
level: 4
opened: 2026-09-16
---

# The Rails: Typed execution DAGs and hermetic tool contracts

**Priority: P2. Level 4 (Architecture / Execution Guarantees).**

## What

Evolve Taskman's execution pipeline (`packages/core/jobs/runner.js`) from a linear sequence of stages (`detect` → `qualify` → `intervene` → `charge`) into an explicit, typed Directed Acyclic Graph (DAG) runtime.

Every capability exposed to the execution engine must be an explicit, schema-enforced OpenAPI/JSONSchema boundary rather than unbounded execution. If an agent produces a payload that violates schema constraints or circular dependency invariants, the rail rejects it at the validation boundary without invoking side effects.

Key elements:
1. **DAG Node Specification:** Nodes declare input schemas, output schemas, dependencies, and rollback handlers.
2. **Topological Scheduler:** Validates acyclicity, executes independent branches in parallel, and halts on node failures.
3. **Hermetic Tool Isolation:** Capability registry enforces strict contract parameters before calling adapters.

## Why it matters

The deterministic core must never rely on LLM intuition to guarantee state, consistency, or delivery. Treating the LLM as an untrusted, stochastic component requires that all state mutations flow through rigid, typed execution rails. Linear pipelines cannot model multi-perspective validation, parallel shadow simulation, or compensating transactions on failure.

## Done looks like

1. `JobSpec` in `packages/core/jobs/job-spec.js` accepts DAG definitions with explicit `dependencies: []`.
2. The runner topologically sorts nodes, detects cycles, and executes parallel steps safely.
3. Every tool invocation passes schema validation before side-effect execution, backed by test coverage.
