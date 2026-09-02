# Taskman System Design (as built)

_Status: as-built, 2026-09-02. Branch `feat/issue-61-cadence-5min`._

## Scope of this document

The other documents in `docs/` describe what Taskman is **for**. `MONEY_TASK_CORE.md`
defines the economic objective, `BRAIN_ARCHITECTURE.md` the decision model,
`FUTURE_DOMINO_MODEL.md` the gap-selection philosophy, `ORCHESTRATION_PIPELINE.md`
the intended stage contract. All of them are specifications.

This document describes what the code **does**, including the places where the
running system diverges from those specifications. Where the two disagree, this
document is descriptive and the others are aspirational. That distinction is the
reason this file exists: the divergences are not small, and one of them is the
reason the system has never produced money.

> **Scope note (2026-09-03):** this document's money/discovery/rail-governance
> sections (§4, §7–§13) are current as of the reconciliation with `main` on this
> date. A large body of unrelated work landed on `main` in parallel — an
> authoritative capability registry, a restructured qualification engine,
> request idempotency, observability/telemetry, and three new rails (DeskCrew,
> Taskmarket, uGig) — documented in their own files (`docs/CAPABILITIES.md`,
> `docs/QUALIFICATION.md`, `docs/OBSERVABILITY.md`, `docs/ERRORS.md`) rather than
> re-described here. §1's diagram and §5–§6 predate that work and describe the
> money-layer's own view of the pipeline; treat their line counts and file
> references as illustrative, not exhaustive.

---

## 1. System at a glance

```text
                      ┌──────────────────────────────────────────┐
                      │  HTTP server (src/server.js, port 3000)  │
                      │  dashboard · task CRUD · brain · revenue │
                      └───────────────┬──────────────────────────┘
                                      │
             ┌────────────────────────┼────────────────────────┐
             │                        │                        │
   ┌─────────▼─────────┐   ┌──────────▼─────────┐   ┌──────────▼─────────┐
   │  DISCOVER worker  │──▶│  VALIDATE worker   │──▶│  EXECUTE worker    │
   │  hourly at :00    │   │  hourly at :10     │   │  every 5 minutes   │
   └─────────┬─────────┘   └──────────┬─────────┘   └──────────┬─────────┘
             │                        │                        │
             ▼                        ▼                        ▼
      candidate_queue          validation_queue          execution_queue
                                                                │
                                                                ▼
                                                        economic_outcomes
                                                        learning_inference

   Cross-cutting: durable-scheduler (leases) · providers (LLM fallback)
                  qualification-engine (scoring) · rails (external work)
                  money-ledger (verified settlement)
```

Node 24 (`.node-version`), ESM, PostgreSQL via `pg`. One runtime dependency for
the legacy engine. Deployed on Render (`render.yaml`) as a web service with a
managed Postgres; `packages/api`/`packages/web`/`packages/crons` are the separate
autonomous-system workspace described in `docs/AUTONOMOUS_SYSTEM.md`.

## 2. Runtime topology

| Process | Entry | Role |
|---|---|---|
| Web | `npm start` → `src/server.js` | Dashboard, JSON API, in-process scheduler timers |
| Worker (CLI) | `node src/worker.js <discover\|validate\|execute\|all>` | One-shot stage run, claims a scheduler lease |
| Migrations | `npm run migrate` → `scripts/migrate.js` | Applied at build time on Render |

`src/db.js` degrades to an in-memory mode when `DATABASE_URL` is unset. Every store
module implements both paths, which is why the test suite runs with no database.
This is convenient and also load-bearing for correctness: the memory path is the
one exercised by CI.

## 3. Data model

33+ tables across 14 migration files (`db/migrations/` for the legacy engine,
`packages/db/migrations/` for the autonomous-system workspace — both applied by
`packages/db/migrate.js`; the legacy engine's own `scripts/migrate.js` applies
`db/migrations/` only). Grouped by what the money-layer tables are actually for
— the mutation ledger, capability, and other upstream-added tables are not
enumerated here; see the docs listed in the scope note above.

**Task execution (001)** — `scenarios`, `tasks`, `task_versions`, `triggers`, `runs`,
`run_steps`. The original recurring-task engine. Live.

**Knowledge (001)** — `knowledge_events`, `knowledge_snapshots`, `strategy_events`,
`future_paths`. Append-only event log plus derived snapshots. Live, written by
`knowledge-store.js` after each run.

**Provider economics (001)** — `providers`, `model_endpoints`, `provider_health`,
`usage_events`. `usage_events` is written by `task-store.js:recordUsage`. Live.

**Money (001)** — `money_events`. Columns for `amount`, `currency`,
`attributable_value`, `confidence`, `evidence`. **One writer**
(`knowledge-store.js:persistMoneyEvent`), reachable only from a knowledge event of
`type === 'money_event'`, which nothing in the pipeline emits. Effectively dead.

**Revenue pipeline (003)** — `revenue_records` (a single table serving all five
queues, discriminated by a `queue` column) and `revenue_scan_state`. Live and busy.

**Scheduler (004, 005)** — `scheduled_jobs`, `scheduled_job_runs`, with lease tokens
for multi-instance safety. Live.

**Settlement ledger (010)** — `rail_attempts`, `settlements`, `rail_state`, and the
`rail_economics` view. Added 2026-09-02. See §8.

## 4. The pipeline

All three stages share one mechanism: `revenue_records` rows are claimed with
`FOR UPDATE SKIP LOCKED`, worked, and written forward into the next queue.

### DISCOVER (`src/workers/discover.js`)

Four configured discovery sources (`DISCOVERY_SOURCES`); the code implements two
real paths:

1. `sampleCandidates` passed by the caller.
2. Configured rails — TaskForce (ledger-gated, disabled by default; §10 gap 5),
   DeskCrew and Taskmarket (config-flag-gated: `DESKCREW_ENABLED`/`TASKMARKET_ENABLED`).

The self-referential anchor-file path (`data/money-flow-search-history.json`) is
deleted — see §9 and §13. Candidates are normalized, scored by `qualifyCandidate()`
against a profile, deduped by `noveltyKey`, and enqueued. Zero real candidates now
returns `zeroCandidates: true` and logs loudly rather than returning silently.

### VALIDATE (`src/workers/validate.js`)

Applies `EIGHT_MONEY_FLOW_GATES` adversarially, optionally with an LLM pass, and
promotes survivors into `execution_queue`.

### EXECUTE (`src/workers/execute.js`)

Claims from `execution_queue`, checks the capability registry, and calls
`executorFn`. Classifies the result and writes to `economic_outcomes`.

## 5. Scoring

Three separate scoring systems coexist:

| Module | Function | Used by |
|---|---|---|
| `brain.js` | `scoreGap`, `scoreOpportunity` | `brain-controller.js` cycles |
| `scenario-engine.js` | `scoreScenario`, `chooseBrainAction` | scenario ranking |
| `qualification-engine.js` | `qualifyCandidate` + profile weights | discover/validate workers |

They do not share a scale or a vocabulary. `brain.js` produces a signed number
roughly in `[-1, 1]`; `qualification-engine.js` produces a weighted profile score
with hard gates. Nothing reconciles them.

## 6. AI provider layer

`src/providers.js` holds an ordered list — Gemini, Groq, OpenRouter — and
`runWithFallback()` walks it, taking the first configured key that succeeds and
recording latency and token counts. `reasoning-engine.js` wraps this with JSON
schema validation (`reasoning-schemas.js`) and per-stage prompts.

The design goal in `MONEY_TASK_CORE.md` §7 is capability-based routing: classify the
gap, then pick the best eligible model. What is implemented is **static ordered
fallback**. Provider choice does not depend on the task, and outcome quality is
recorded but never fed back into ordering.

## 7. Rails and the execution gate

`RailAdapter` (`src/rails/base.js`) defines a two-mode adapter — `read_only` and
`execute` — with `assertExecutable()` guarding every side-effecting method. Rails
register into a `Map` and are looked up by name.

`execution-gate.js` holds nine hard gates (`payerVerified`, `taskOpen`,
`acceptanceCriteriaClear`, `deliveryPathExecutable`, `noContradictoryInstructions`,
`payoutPathExecutable`, `noRecurringManualStep`, `noUpfrontSpend`,
`noUnsupportedSigning`) and fails closed.

Five rails are registered: `TaskForceRail` (`task-force.app`) and a MoltJobs
client (`moltjobs.io`) — both agent-work-marketplace, both ledger-disabled by
default (§10 gap 5, `src/rails/dead-rails.js`) — plus DeskCrew, Taskmarket and
uGig, added upstream in parallel with this document's money-layer work and gated
by their own config flags rather than the settlement ledger. Granting a rail
execute mode now requires **both** gates to agree — the operator allowlist
(`TASKMAN_ALLOW_WRITE_RAILS`/`TASKMAN_WRITE_RAILS`, `src/config.js`) and a
non-`DISABLED` ledger state — composed in `src/rails/index.js:enableRailExecution()`.

## 8. Money ledger

Added to close the gap in §3. `money-ledger.js` is the only module permitted to
record realized money, and it enforces two invariants at the API and schema level:

- `source` must be one of `stripe`, `bank`, `manual_receipt` — enforced by a `CHECK`
  constraint, so unverifiable revenue is not representable in the table.
- `externalRef` is required and `UNIQUE(source, external_ref)`, so a settlement
  cannot be invented and cannot be double-counted.

`settlement-verifier.js` reads Stripe `balance_transactions` (GET only, never moves
money) and treats only `status: 'available'` as cleared.

`evaluateRailViability()` is the stopping rule: a rail that spends its probation
budget (default $50) or its attempt allowance (default 25) with zero verified
settlements is disabled. `enforceRailViability()` applies it.

## 9. What actually happens on a scheduled run

This is the most important section in this document.

Trace a production hour with no `TASKFORCE_API_KEY` configured:

1. **:00 DISCOVER fires.** `sampleCandidates` is empty — the scheduler passes none.
2. The TaskForce rail returns `{ ok: false, blocked: true }`; nothing is discovered.
3. Because `discovered.length === 0`, the third path runs and reads
   `data/money-flow-search-history.json`, enqueuing `current_leader` as a candidate.
4. The AI synthesis branch requires `sampleCandidates.length > 0`, so it is skipped.
5. The novelty key is `anchor-{id}-{updated_at}`. The file does not change unless a
   human edits it — so from the second hour onward, dedup rejects the only candidate
   and **discover enqueues nothing, forever**.
6. **:05, :10, … EXECUTE fires** twelve times an hour. Before the ledger, `executorFn`
   defaulted to `null`, so every candidate resolved to
   `BLOCKED: "No authorized executable action adapter configured"`.

The loop's only self-sustaining input is a file the loop itself wrote. It rediscovers
its own prior conclusion, fails to execute it, and records the failure as a lesson.
The 24 run files in `data/money-flow-runs/` are that process: the leader score drifts
from 50 down to 46 as each candidate is argued away, and no candidate is ever tried.

## 10. Known gaps

Phases 2–5 of `TARGET_DESIGN.md` §11 are implemented (2026-09-02). Status below.

| # | Gap | Evidence | State |
|---|---|---|---|
| 1 | Discovery is self-referential | §9. Sole scheduled source was the system's own anchor file | **Closed** — the anchor-file path is deleted from `discoverFromRealSources()`; `DISCOVERY_SOURCES` no longer lists `structural_money_flow`. Deterministic collectors (`packages/core/drones`) are the replacement source, feeding `candidate_queue` via the `signal-process` cron. Zero real candidates now returns `zeroCandidates: true` and logs loudly instead of silently repeating. |
| 2 | `money_events` is unreachable | One writer, no emitter | **Closed** (prior session) — superseded by `settlements`/`rail_attempts` (010). `money_events` remains in the schema, unused; a future migration may drop it. |
| 3 | Three unreconciled scoring systems | §5 | Open — `brain.js`, `scenario-engine.js`, `qualification-engine.js` still share no scale. Out of scope for phases 2–5. |
| 4 | Provider routing is static, not capability-based | §6 vs `MONEY_TASK_CORE.md` §7 | Open — `providers.js` is still an ordered fallback list. |
| 5 | Both rails target a market measured at 2 settled payouts in 30 days | `TARGET_DESIGN.md` §2 | **Closed** — `TaskForceRail` and the MoltJobs client are registered but seeded `DISABLED` by `src/rails/dead-rails.js` with the measurement as `disabled_reason`. `discoverRail()` and `enableRailExecution()` both refuse a disabled rail. Code and tests kept intact; re-enabling either is a one-line manual call with fresh evidence. |
| 6 | No cost accounting per attempt before 006 | `usage_events` tracks tokens, not attempts | **Closed** (prior session) — `rail_attempts.cost_cents`. |
| 7 | Economic learning cannot descend | Reward was identically zero, so all strategies scored equally | **Closed** — settlements are non-zero and varied once a rail proves itself; the governor (§12) now ranks rails by realized ROI, not by argument. |
| 8 | No stopping rule beyond a single probation budget | — | **Closed** — the four-state governor (§12) adds promotion (PROVEN, SCALED) and a global monthly cap, not just a kill switch. |
| 9 | AI calls were unchecked beyond JSON schema shape | — | **Closed** — `src/transforms/` adds a deterministic post-condition per call site; discovery calls no model at all. See §13. |

## 11. Invariants

Enforced in code:

- Rails default to `read_only`; side effects require an explicit mode change.
- The execution gate fails closed on any missing hard gate.
- Discovery never fabricates candidates — every path returns empty rather than inventing, and never calls a model (§13).
- Realized value requires a settlement with an external reference (010).
- A rail that fails to pay within its probation budget is switched off automatically by the governor (§12); re-enabling one is a manual act only.
- A model call's output must satisfy both a JSON schema and a transform-specific deterministic post-condition before a worker may use it (§13).

## 12. The rail governor (Phase 4)

`src/rail-governor.js`, backing `packages/core`'s re-export and `/api/money/rails/:rail/governor` and `/api/money/budget`. Four states, computed from `rail_economics` and never argued:

```text
PROBATION → PROVEN     first cleared settlement since this probation window began
PROBATION → DISABLED   probation budget or attempt allowance spent, zero settled
PROVEN    → SCALED     ≥10 lifetime cleared settlements at lifetime ROI ≥ 3.0
PROVEN    → PROBATION  trailing-30-day ROI fell below 1.0
SCALED    → PROVEN     lifetime ROI fell below 2.0
DISABLED  → (nothing)  leaves only by a human calling setRailEnabled(rail, true)
```

Two correctness details worth naming:

- **A manual re-enable gets a genuine fresh budget.** `rail_state.probation_epoch`
  increments on every entry into PROBATION, and every `rail_attempts`/`settlements`
  row is stamped with the epoch active when it was written. Windowed checks filter
  by epoch equality, not by a timestamp boundary — a wall-clock comparison cannot
  safely separate "before re-enable" from "after" when two writes land in the same
  instant, which is reproducible even in single-threaded tests with no real I/O
  between steps (`test/rail-governor.test.js`).
- **A global monthly cap** (`global_budget` table, default $500) bounds spend
  across every rail combined, including a `SCALED` rail whose own per-rail budget
  no longer applies. `runExecuteWorker` refuses to claim any work once the cap is
  hit, returning `GLOBAL_BUDGET_EXCEEDED` rather than silently continuing.

`enforceRailViability`/`evaluateRailViability` (the original two-verdict PROBATION
check from the prior session) remain, unchanged, for callers that only need
CONTINUE/DISABLE — the execute worker still calls both, since the two rarely
disagree and neither reads or writes state the other depends on.

## 13. The LLM boundary (Phase 5)

`src/transforms/` is the only place a model call happens outside the reasoning
engine's own unit tests. Two live transforms:

- `runAdversarialValidation` (`adversarial-validation.js`), called from
  `validate.js`. Post-condition: every gate verdict is one of pass/fail/uncertain,
  and every non-uncertain verdict carries an `evidenceRef` that is not empty, not
  a placeholder ("n/a", "pending"), and not just the gate's own name echoed back —
  schema validation checks the JSON shape but cannot tell a citation from a model
  restating the question.
- `runExecutionPlan` (`execution-plan.js`), called from `execute.js`. Post-condition:
  every plan step's `capability` is actually present and truthy in the capability
  registry passed in — schema validation cannot catch a plausible-sounding plan
  that invents a capability (e.g. `funds.move`) the system was never granted.

A transform that fails its post-condition is discarded, not repaired: the caller
proceeds exactly as if no AI were configured, never with a partially-trusted
result. `src/workers/discover.js` calls no transform and no model at all —
discovery is deterministic by contract (§9); a model may narrow or check a
candidate that already exists, never originate one.

`sharedReasoningEngine.synthesizeDiscovery()` and `.planEvidenceGaps()` remain on
`ReasoningEngine` as tested, general-purpose capabilities of the engine itself.
Nothing in the pipeline calls them — the invariant is that discovery does not, not
that the method cannot exist.

Documented but **not** enforced:

- Capability-based model routing (`MONEY_TASK_CORE.md` §7).
- Relevance-scoped context retrieval — `buildRelevantContext()` exists and caps facts
  at 20, but the workers do not call it.
- "One-time setup, then reuse" — setup state is not stored separately from run context.
