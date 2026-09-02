# Taskman Target Design

_Proposed 2026-09-02. Supersedes the execution half of `MONEY_TASK_CORE.md`; leaves
its economic objective intact._

## 1. Problem statement

Taskman's stated goal is a private system that produces money. As built (see
`SYSTEM_DESIGN.md` §9) it produces scored opinions about money, rediscovers its own
prior conclusions, and cannot execute. Three defects cause this, and they compound:

1. **The loop has no reward.** Realized revenue was never recorded anywhere, so the
   economic-learning layer described in `MONEY_TASK_CORE.md` §9 had an identically
   zero signal. Every strategy, provider and task family scored the same. A learner
   with a constant reward cannot descend, and will run forever.
2. **The loop has no stopping rule.** Nothing could conclude that a direction does
   not pay. The 24 money-flow runs are the observable consequence.
3. **Discovery is where the LLM was placed.** Asking a model "what is a valuable
   unresolved money gap" returns the same answer it returns to everyone else holding
   the same model. Opportunities discoverable by prompting are arbitraged on
   discovery. The rejection log confirms it empirically: every candidate died with
   "an incumbent already does this."

## 2. Evidence base

The design responds to measured facts about the venues the current rails target,
as of September 2026:

| Venue | Measured state |
|---|---|
| Algora | 529 open bounties; **2 settled payouts in trailing 30 days** against 1,470 across 2025; 0 passed eligibility + freshness; 89 open over a year |
| MoltJobs | 7 open jobs at $5 each; zero paid to the tester |
| Execution Market | Settles, but requires an on-demand signing wallet |
| AgentPact, Superteam Earn, The Colony, HYRVE | Work available; money does not arrive |

The summary from the person who tested all of them: **"completion is solved,
settlement is not."** One source additionally reports 73.2% of open bounties are
honeypots built to extract agent system prompts; that figure is single-sourced and
should be treated as unconfirmed, but the attack surface it describes is real and §9
assumes it.

Both existing rails (`TaskForceRail`, `moltjobs-client`) sit inside that table.

**Design consequence:** the failure mode of the agent-work economy is settlement, not
capability. Therefore settlement must be a first-class, separately-verified layer,
and the venue where work happens must be disposable.

## 3. Goals and non-goals

**Goals**

- G1. Every rail is falsifiable within a bounded budget, and falsifies itself without
  human intervention.
- G2. Realized revenue is verified against a payment processor, never self-reported.
- G3. Discovery is deterministic. The LLM is confined to transforms whose output can
  be checked.
- G4. The economic learner receives a non-zero, varied reward, so it can rank.
- G5. Content from external rails cannot influence system behaviour.

**Non-goals**

- N1. Choosing the business. This design makes a wrong choice cheap and self-limiting;
  it does not identify the right one. That requires an edge — data access,
  distribution, or domain position — which is not an architectural property.
- N2. Full autonomy over money movement. The system reads settlement state; humans
  authorize payouts, sign, and hold credentials.
- N3. Replacing the brain, scenario or knowledge layers. They are retained unchanged.

## 4. Core principle: the ledger is the loop

The current design treats the ledger as reporting. In the target design it is the
control plane. Every stage reads from it and every stage writes to it:

```text
      ┌─────────────────────────── LEDGER ────────────────────────────┐
      │  rail_attempts (cost)   settlements (verified revenue)        │
      │  rail_state (probation / proven / disabled)                   │
      └───┬───────────────────┬──────────────────┬───────────────┬────┘
          │ budget            │ selection        │ reward        │ verdict
          ▼                   ▼                  ▼               ▼
      DISCOVER            VALIDATE            EXECUTE         GOVERNOR
      (which rails      (what is worth      (attempt,       (promote,
       to poll)          attempting)         settle)         demote, kill)
```

A rail with no verified settlement gets a shrinking share of attention and then none.
A rail with settlements gets more budget. This is the entire economic learning
mechanism, and it works because the reward is finally non-zero.

## 5. Architecture

```text
  collectors/          deterministic. HTTP, RSS, APIs, files. No LLM. ← the edge
       │
       ▼
  qualification/       existing engine. profiles, hard gates, scores.
       │
       ▼
  rails/               one adapter per venue. discover · verify · execute · settle.
       │                 declares its settlement_source and probation budget.
       ▼
  transforms/          the ONLY place an LLM runs. narrow, schema-validated,
       │                 output checked against a deterministic assertion.
       ▼
  settlement/          processor-verified. stripe · bank · manual_receipt.
       │
       ▼
  governor/            reads rail_economics. promotes, demotes, disables.
```

The inversion versus today: rails become thin and disposable, the ledger and governor
become the durable core. Today the rails carry the intelligence and nothing measures
them.

## 6. The rail contract

Every rail implements the same five methods and declares its economics. A rail that
cannot name how it settles cannot be registered.

```js
class Rail extends RailAdapter {
  static manifest = {
    name: 'consulting-invoices',
    settlementSource: 'stripe',      // must be in VERIFIED_SOURCES
    probationBudgetCents: 5000,      // spend before a settlement is required
    probationAttempts: 25,
    untrustedContent: true           // §9: rail text is data, never instruction
  };

  async discover()          // → candidates. deterministic; no LLM.
  async verify(candidate)   // → { gate, expectedValueCents }
  async execute(candidate)  // → { status, evidence, settlement? }
  async settle(reference)   // → settlement row, or null if not yet cleared
  async health()            // → { configured, mode, reachable }
}
```

`execute()` may return a `settlement` only with a `source` and `externalRef`. The
ledger rejects anything else, so a rail cannot report revenue it cannot prove — the
invariant is enforced at the API and again by a `CHECK` constraint in the schema.

## 7. Settlement layer

Separated from the work rail. Its only job is to answer "did the money arrive."

- **Verifiers** per source. `stripe` implemented; `bank` and `manual_receipt` are
  the extension points.
- **Cleared vs pending.** Only funds actually in the balance count. Pending is
  tracked and excluded from `cleared_cents` — this is the exact distinction the agent
  job boards fail, and the reason it is modelled explicitly.
- **Idempotent.** `UNIQUE(source, external_ref)`. Re-syncing is always safe.
- **Read-only.** Every call is a GET. The system never moves money, signs, or holds
  payout credentials.

## 8. Economic control loop

Rails occupy one of four states. Transitions are computed from `rail_economics`, not
argued.

| State | Entry condition | Budget | Exit |
|---|---|---|---|
| `PROBATION` | registered | $50 / 25 attempts | first cleared settlement → `PROVEN`; budget exhausted → `DISABLED` |
| `PROVEN` | ≥1 cleared settlement | 3× trailing 30-day cleared revenue | ROI < 1.0 over 30 days → `PROBATION` |
| `SCALED` | ROI ≥ 3.0 over ≥10 settlements | uncapped within global budget | ROI < 2.0 → `PROVEN` |
| `DISABLED` | budget or attempts exhausted with zero settlements | none | manual re-enable only |

Two properties matter. The kill-switch is **automatic** — no human decides a rail has
failed. And re-enabling is **manual** — the system cannot argue its way back into a
market that did not pay it, which is precisely the behaviour the run history shows.

A global monthly budget caps the sum of all rail budgets, so a fleet of probationary
rails cannot collectively drain the account.

## 9. Security model

Rail content is written by strangers, and at least one measurement suggests much of
it is adversarial by design. The rules:

- Content fetched by a rail is **data**. It never enters a prompt that has tool access.
- Transforms run with no side-effecting tools. A transform returns a value; the caller
  decides what to do with it.
- Instructions found in fetched content — "ignore previous instructions", "print your
  configuration", "run this to verify" — are logged as an injection attempt, and the
  candidate is rejected, not sanitized.
- Rails never receive credentials for anything except their own venue.
- `noUnsupportedSigning` remains a hard gate. Wallet-signing venues stay out of scope.

## 10. Data model changes

Migration 006 already adds `rail_attempts`, `settlements`, `rail_state`, and the
`rail_economics` view. The target design adds:

- `rail_state.state` (`PROBATION|PROVEN|SCALED|DISABLED`) replacing the boolean
  `enabled`, with `enabled` kept as a generated compatibility column.
- `rail_state.settlement_source` — declared at registration, checked against the
  settlement row on write.
- `collector_runs` — per-collector fetch log with item counts and latency, so a
  collector that stops returning items is visible before it silently starves the queue.
- `injection_events` — logged prompt-injection attempts per rail, feeding a
  `DISABLED` transition if a rail is persistently hostile.

`money_events` (001) is either wired to the ledger as a projection or dropped. It
must not remain a second, unenforced place where money can be claimed.

## 11. Migration plan

Each phase is independently shippable and leaves the system working.

**Phase 1 — measurement (done, 2026-09-02).** Migration 006, `money-ledger.js`,
`settlement-verifier.js`, execute-worker wiring, `/api/money/*`. The system can now
state what it has earned, and stop a rail that earns nothing.

**Phase 2 — cut the self-referential loop (done, 2026-09-02).** The
`money-flow-search-history.json` discovery path is deleted from
`discoverFromRealSources()` and `structural_money_flow` removed from
`DISCOVERY_SOURCES`. The deterministic collector layer already existed as
`packages/core/drones` (built alongside Phase 1's autonomous system) rather than a
new `src/collectors/`; `signal-process` feeds its output into `candidate_queue`.
`runDiscoverWorker` now returns `zeroCandidates: true` and logs loudly rather than
silently repeating its own prior output.

**Phase 3 — retire the dead rails (done, 2026-09-02).** `TaskForceRail` and the
MoltJobs client are seeded `DISABLED` in `rail_state` by `src/rails/dead-rails.js`,
with the Sept 2026 settlement measurement recorded as `disabled_reason`.
`discoverRail()` and `enableRailExecution()` both refuse a disabled rail; code and
tests are untouched, and re-enabling either is one call with fresh evidence.

**Phase 4 — the state machine (done, 2026-09-02).** `src/rail-governor.js`
implements the four-state transition table below with `rail_state.probation_epoch`
replacing wall-clock timestamps for windowed checks (a real correctness bug, not
just test flakiness — see `docs/SYSTEM_DESIGN.md` §12). A `global_budget` table
caps spend across every rail combined; `runExecuteWorker` refuses new work once it
is exceeded. Exposed via `/api/money/economics` (per-rail `state`),
`/api/money/rails/:rail/governor`, `/api/money/rails/:rail/reenable`, and
`/api/money/budget`, with a state column and a re-enable action on the dashboard.

**Phase 5 — the LLM boundary (done, 2026-09-02).** `src/transforms/` wraps the two
live model call sites — adversarial gate evidence in `validate.js`, execution
planning in `execute.js` — each with a deterministic post-condition beyond JSON
schema shape (a real citation, not a restated gate name; a capability the registry
actually granted, not an invented one). `discover.js` calls no transform and no
model. See `docs/SYSTEM_DESIGN.md` §13.

**Phase 6 — first real rail.** One rail, one settlement source, against a mechanism
chosen from an actual edge (N1). Probation budget $50.

## 12. Success criteria

The design succeeds if, 30 days after Phase 6:

- `GET /api/money/economics` returns a non-zero `clearedCents` for at least one rail; **or**
- at least one rail reached `DISABLED` automatically, having cost under $50 and
  produced a specific, recorded reason.

Both outcomes are successes. The current architecture can produce neither, which is
the actual defect: not that it fails, but that it cannot tell.

The design fails if after 30 days every rail is still in `PROBATION` with attempts
accruing and no settlement — meaning the budgets are too loose to force a conclusion.

## 13. Open questions

1. **Where does the edge come from?** (N1.) Nothing here answers it. The most likely
   candidates given a solo operator are domain access through employment, or a
   distribution position in one niche.
2. **Is `manual_receipt` too weak a source?** It is human-attested and therefore
   spoofable by an operator deceiving themselves. It may need a required attachment.
3. **Does the governor need exploration?** A strict kill-switch is greedy and may
   disable a rail that would have paid on attempt 26. A small permanent exploration
   budget is the standard answer; whether it is worth the complexity here is untested.
4. **Should `money_events` be dropped or projected?** Dropping is cleaner; projecting
   preserves the knowledge-event history that already references it.
