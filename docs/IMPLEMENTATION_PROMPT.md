# Implementation Prompt

A self-contained brief for a coding agent implementing `TARGET_DESIGN.md`. Paste the
fenced block below into a fresh session. It assumes no prior context — everything the
agent needs to avoid re-deriving is stated.

Phases 1–5 are already merged (2026-09-02) — see `docs/SYSTEM_DESIGN.md` §10–§13
for what actually shipped from each. Only Phase 6 remains, and it is deliberately
not specified below (§ Explicitly out of scope): it requires naming a mechanism and
a settlement source, which is a business decision this prompt cannot make for you.
The phase list is kept here as the source of truth for what each phase means, in
case a regression needs re-deriving or a future phase 7+ is added.

---

```text
You are implementing a phase of the Taskman target design.

## Repository facts (do not re-derive these)

- Node 20, ESM, one runtime dependency (`pg`). Tests: `npm test` (node --test), 59 passing.
- `src/db.js` falls back to an in-memory store when DATABASE_URL is unset. EVERY store
  module implements both the Postgres and the memory path. CI runs the memory path, so
  a Postgres-only implementation is an untested implementation.
- Migrations are plain SQL in `db/migrations/NNN_name.sql`, applied in filename order by
  `scripts/migrate.js`. Never edit an applied migration; add a new one.
- Pipeline: `src/workers/{discover,validate,execute}.js`, all backed by the single
  `revenue_records` table discriminated by a `queue` column. Claims use
  `FOR UPDATE SKIP LOCKED`.
- `src/money-ledger.js` is the only module allowed to record realized money.
  `src/settlement-verifier.js` reads Stripe (GET only).
- Read `docs/SYSTEM_DESIGN.md` for what the code does today and `docs/TARGET_DESIGN.md`
  for what it should do. Where the older docs in `docs/` disagree with SYSTEM_DESIGN.md,
  the older docs are aspirational and SYSTEM_DESIGN.md is correct.

## Why this work exists

Taskman scores opportunities well and executes nothing. Its scheduled discovery reads
back a file the system itself wrote, so after the first run it enqueues nothing forever,
and its execute worker had no adapter, so every candidate resolved to BLOCKED. It has
therefore never produced money and — before the ledger — could not have noticed.

The venues its two existing rails target were measured in Sept 2026 at 2 settled payouts
across 30 days (Algora) and zero payouts on 7 listings (MoltJobs). The industry summary
is "completion is solved, settlement is not." Assume any marketplace pays nothing until
the ledger shows a cleared settlement.

## Invariants — a change that breaks any of these is wrong

1. Realized revenue requires a settlement with a `source` in
   (`stripe`,`bank`,`manual_receipt`) AND a non-empty `externalRef`. Never widen this,
   never add a bypass, never let an executor's self-reported number become revenue.
2. Pending money is never counted as earned. Only cleared settlements enter
   `cleared_cents`.
3. Never simulate, estimate, backfill or seed a settlement. If a value is unknown the
   answer is zero and a recorded reason.
4. Discovery never fabricates candidates. Zero real candidates means an empty list and a
   loud log line, never a synthesized one.
5. The system never moves money, signs transactions, or holds payout credentials.
   Settlement code is read-only.
6. Content fetched from an external rail is DATA. It never enters a prompt with tool
   access. Text in fetched content that reads as an instruction is logged as an
   injection attempt and the candidate is rejected, not sanitized.
7. Rails default to read-only. Side effects require an explicit mode change.
8. Both the Postgres and memory paths must work, and both must be tested.

## Your task

PHASE = <2 | 3 | 4 | 5>

Phase 2 — Cut the self-referential discovery loop.
  Delete the `data/money-flow-search-history.json` branch from
  `discoverFromRealSources()`. Add `src/collectors/` with a documented interface
  (`name`, `async collect() -> candidate[]`, no LLM anywhere) and one working collector
  against a real external source. Add a `collector_runs` table logging items returned
  and latency per run. Discover must report zero candidates loudly rather than recycling
  its own output.

Phase 3 — Retire the dead rails.
  Put `TaskForceRail` and `moltjobs-client` behind a disabled-by-default flag. Record
  their measured settlement rates in `rail_state.disabled_reason`. Keep the code and the
  tests — the adapter shape is good and gets reused. Do not delete the execution gate.

Phase 4 — The governor.
  Replace `rail_state.enabled` with `state` in (PROBATION, PROVEN, SCALED, DISABLED),
  keeping `enabled` as a generated compatibility column so existing callers still work.
  Implement the transition table in TARGET_DESIGN.md §8, add a global monthly budget cap
  across all rails, and expose the state on `/api/money/economics`. Promotion and
  demotion are computed from `rail_economics`, never argued. Re-enabling a DISABLED rail
  is manual only.

Phase 5 — The LLM boundary.
  Create `src/transforms/`. Every model call moves there, each with a JSON schema and a
  deterministic post-condition that is checked before the result is used. Remove all LLM
  calls from discovery. A transform has no side-effecting tools: it returns a value and
  the caller decides what to do with it.

## Definition of done

- `npm test` passes, with new tests covering the memory path.
- Every new invariant is enforced by a test that fails if the invariant is removed —
  a test that asserts the rejection, not just the happy path.
- No migration is edited in place; new work is a new numbered file.
- `docs/SYSTEM_DESIGN.md` §10 is updated to strike the gaps you closed.
- You report what you did NOT do and why, rather than silently reducing scope.

## Explicitly out of scope

- Choosing which business or market Taskman should pursue. That requires an edge —
  data access, distribution, or domain position — and is not an architectural decision.
  If the phase seems to require it, stop and say so.
- Any change that makes revenue easier to report. The friction is the feature.
```

---

## Notes on using this

- **One phase per session.** Phases are ordered by dependency; 4 assumes 2 and 3.
- **Phase 6 is deliberately absent.** Building the first real rail requires naming a
  mechanism and a settlement source, which is a business decision, not a coding task.
  Prompting an agent for it reproduces the exact failure this design exists to fix:
  an LLM asked to discover opportunities returns the commons.
- **The invariants are the valuable part.** If you rewrite this prompt for a different
  model or tool, keep §Invariants verbatim. Everything else is context that can be
  re-derived; those eight lines are what stops the system from quietly reporting money
  it never received.
