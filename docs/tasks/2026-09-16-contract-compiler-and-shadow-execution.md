---
status: open
priority: P2
level: 4
opened: 2026-09-16
---

# The Bridge: Contract compiler, shadow execution, and human gatekeeper

**Priority: P2. Level 4 (Arbitration & Bridge).**

## What

Build the arbitration and synthesis bridge that connects stochastic plan generation (Layer 2) to deterministic execution rails (Layer 1), preventing "leaky abstraction" state corruption.

The bridge consists of three components:
1. **Contract Compiler:** Ingests open-ended LLM plans, validates dependencies, checks tool mappings against registered capabilities, and compiles them into rigid DAG descriptors. Circular dependencies or invalid schemas are rejected back to the generator with compiler diagnostics.
2. **Shadow Execution:** Runs candidate plans against an isolated sandbox, read-only clone, or simulated staging environment (e.g. temporary `/tmp` git clone) before committing any state mutation to the live ledger or queues.
3. **Human-in-the-Loop Gateway:** Enforces hard circuit breakers on high-consequence state shifts (e.g. sending outbound messages, executing payments, or altering database states) requiring cryptographic or explicit operator clearance tokens (`--approve`).

## Why it matters

The greatest failure mode in autonomous agent architectures is unvalidated stochastic output mutating production state directly. Without a formal compiler and sandbox shadow execution, hallucinated findings or unverified assumptions leak into the ledger or external communication, destroying trust and burning sender reputation.

## Built 2026-09-17

Core built and mutation-tested. See the commit; the module is the first step, wiring it into the live sweep/runner is the remainder.

## Done looks like

1. A `compilePlanToDAG()` module validates proposed step dependencies and rejects unmapped tool invocations.
2. Shadow execution runs non-mutating checks in temporary sandboxes and feeds execution feedback back to the plan generator.
3. High-consequence transitions pause execution deterministically until an operator token is supplied, matching the `intervene` gate in `packages/core/jobs/runner.js`.
