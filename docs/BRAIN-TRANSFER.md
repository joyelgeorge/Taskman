# Taskman Brain Transfer

A grounded inventory of the real logic, rules, and disproof history built into
this codebase — written to be handed to a new Taskman brain/AI so it does not
have to relearn any of this the hard way. Everything below was read directly
from the source in this repo (paths given); nothing here is inferred from a
dashboard, a commit message, or a prior model's summary. Where something is a
placeholder rather than working logic, that is called out explicitly.

If you are the new brain: read the "Disproof registry" section first. Most of
the value in this document is what NOT to try again, and why.

---

## 1. The one strategic finding that governs everything else

Taskman built enormous SUPPLY (scanners, drones, scoring, execution
pipelines) and never validated DEMAND — a real person demonstrably paying —
before building each one. Every lane died at the payment step, not the
technical step. The corrective rule: **start from visible, already-paying
demand, then point proven capability at it.** (`CLAUDE.md`, 2026-09-08
finding.)

A second, more specific finding (2026-09-11) confirmed this concretely: the
engine's own hardcoded opportunity feed (§6 below) was fictional, and one
staging script was asserting `testsPassed: true` for code that did not
exist. Fixed in `src/autonomous-engine.js`; see §13.

**Rule for the new brain (calibrated 2026-09-11, `src/evidence-tier.js`):**
a reference gates ASSERTION and SPEND, never EXPLORATION.

An earlier phrasing of this rule required a verifiable external reference
before pursuing any opportunity. That version was wrong, and dangerously so:
combined with §1's own "start from visible, already-paying demand", it would
have confined the engine to opportunities already listed on public boards —
which §14 records as picked clean (`github-bounty-hunt`: 403 listings, 0
winnable). The rule against inventing counterparties would have become a rule
against discovering real ones.

Three tiers instead:

1. **Explore freely.** No reference is needed to enter the pipeline. `isNovel()`
   stays the only novelty filter, and it rejects nothing but exact repeats and
   aliases of KILLED lanes.
2. **Assert honestly.** Without a resolvable reference a candidate is typed
   `HYPOTHESIS` and may not claim `escrow`, a precise `rewardDollars`, or a
   calibrated `pSuccess`. The figure survives as
   `unverifiedRewardEstimateDollars` with `rewardBasis: 'unverified_estimate'`,
   and the candidate is decided `NEEDS_EVIDENCE` — which
   `rankEconomicOpportunities` already prioritises ABOVE skip and
   setup-required, so it gets investigated rather than dropped.
3. **Spend and claim carefully.** A reference is required before real cost is
   incurred and before any counterparty claim (DELIVERED / ACCEPTED / CLEARED /
   INVOICED). `money-ledger.js` already enforces the settlement end properly.

A reference is deliberately broad — any resolvable URL counts, a forum thread as
readily as a bounty listing, because demand signals are where unexplored lanes
start. What does not count is a generic label like `'Algora / GitHub OSS
Bounty'`, which names a venue and identifies nothing.

Note what this does NOT gate: `TESTED_AND_READY` is an internal claim with
internal evidence (a real test exit code). Requiring a counterparty reference
for it would block finishing honest work on a new lane before anyone could be
shown it.

---

## 2. Settlement ledger — `src/money-ledger.js`

This is the single source of truth for whether money was actually made.

- **States**: `ATTEMPT_STATUS` (STARTED / BLOCKED / SETUP_REQUIRED /
  DELIVERED / ACCEPTED / REJECTED / FAILED), `SETTLEMENT_STATUS` (PENDING /
  CLEARED / REVERSED), `RAIL_STATES` (PROBATION / PROVEN / SCALED /
  DISABLED).
- **Hard invariant**: `recordSettlement` throws unless `source` is one of
  `VERIFIED_SOURCES = ['stripe', 'paypal', 'bank', 'manual_receipt']` and
  `externalRef` is non-empty. Self-reported revenue with no external
  reference is structurally impossible to record — a script that wants to
  fake a "CLEARED" settlement has to go around the ledger entirely (which is
  exactly what `scripts/complete-fiverr-audit-settlement.js` did, by writing
  its own JSON file instead of using this function honestly — see §13).
- **Idempotency**: upsert on `(source, external_ref)`, same behavior in
  memory and Postgres modes.
- **Settlement lag**: `SETTLEMENT_LAG_DAYS` per rail (fiverr 14, upwork 10,
  stripe 7, paypal 3, invoice 30, default 30) — a young pending attempt is
  not counted as a failure just because it hasn't cleared yet.
- **Rail probation economics**: `evaluateRailViability` /
  `enforceRailViability` disable a rail after it spends
  `probationBudgetCents` (default $50) or reaches `minAttempts` (25) with
  zero cleared settlements. `probation_epoch` (not a timestamp) scopes each
  probation window so a manual re-enable starts clean.

## 3. Bounty triage — 5 gates + a separate 9-gate execution check

Two different gating systems exist under similar names — do not conflate
them.

**A. The 5-gate bounty triage** (`.claude/skills/taskman-bounty-triage/`,
implemented in `packages/core/bounties/triage.js`):

1. `TRAP_CHECK` — scans full listing text via `detectInjection` for
   prompt/credential-exfiltration honeypot signatures (documented: ~73.2% of
   agent bounties are honeypots).
2. `FUNDING_CHECK` — `extractBountyReward` parses a real USD figure via
   regexes matching `bounty:`, `reward:`, `bounty=N`, `algora.io/...bounty=N`,
   `polar.sh/...reward=N`, etc; rejected unless a verified platform badge
   (Algora/Polar/Gitcoin/etc.) is present or the reward is ≥ $5.
3. `REACHABILITY_CHECK` — rejects geo-walls (`US-only`, `EU residents only`,
   "requires US/EU bank account").
4. `SCOPE_CHECK` — rejects subjective UI/UX redesign, product
   strategy/vision, hardware requirements, user interviews, sales decks, and
   known toy-benchmark honeypots (e.g. "calculate pi").
5. `AI_POLICY_CHECK` — checks `CONTRIBUTING.md`/`AI.md` text for an AI ban;
   fails closed, citing the exact policy text.

**Hard invariant**: never call an auto-submit API against an external repo
(Algora terms prohibit robotic access; 37 OSS projects ban AI contributions
outright — Issue #194). The agent always produces a `CANDIDATE_PREPARED`
artifact for a human to review and submit, with a mandatory disclosure
string: *"This contribution was drafted with AI assistance (Taskman).
Reviewed, verified, and submitted by a human operator."*

**B. The 9 hard execution gates** (`src/rails/execution-gate.js`,
`HARD_GATES`) — a separate, code-level checklist an opportunity must clear
before execution regardless of triage: `payerVerified`, `taskOpen`,
`acceptanceCriteriaClear`, `deliveryPathExecutable`,
`noContradictoryInstructions`, `payoutPathExecutable`,
`noRecurringManualStep`, `noUpfrontSpend`, `noUnsupportedSigning`. Combined
with an EV formula:
`(payout × acceptanceProbability × settlementProbability) / executionFriction`.

Note: `src/gates.js` is a thin re-export of `EIGHT_MONEY_FLOW_GATES` from
`orchestration-profiles.js` — a third, differently-scoped gate set for
money-flow candidates, not the bounty-triage gates. The naming overlap has
caused confusion before; keep the three systems distinct.

## 4. Payout reconciliation — the one product with real, working algorithms

- **`src/payout-csv.js`** — header-detection CSV parser (`detectColumns`)
  that scores column names against role hints (net/fee/gross/date/id/
  currency/description). Deliberately does **not** assume a fee exists
  unless a fee column is present — this replaced an earlier Fiverr-only
  parser that assumed a fixed 20% commission, now recognized as actively
  harmful ("a tool whose failure mode is telling someone they were
  underpaid when they were not is worse than no tool"). `toCents` handles
  parenthesized negatives like `(1,234.56)` and leading `-$`.
- **`src/instant-audit.js`** — `matchPayouts` greedily matches platform
  earnings to bank deposits: amount within `AMOUNT_TOLERANCE_CENTS = 2`,
  date within `MATCH_WINDOW_DAYS = 45`, each deposit consumable once,
  ties broken by closest date. Unmatched earnings are reported as "no
  deposit found in these files" — **never** as "stolen"; the design is
  deliberately conservative because a false accusation ends the
  relationship. `instantAudit()` is the stateless, no-signup, no-storage
  entry point, built specifically to remove the three-gate signup wall
  (`customer-workflow.js`'s INACTIVE→ACTIVE requirements) that its own doc
  comment says killed conversion before: *"the only people who could ever
  see a finding were people who had already signed up. Nobody signs up to
  find out whether there is anything to find."*
- **`src/commercial-wedge.js`** — `reconcileFiverrPayoutBatch` sums
  gross/fee/net vs. bank deposits, flags `VARIANCE_DETECTED` in either
  direction. `COMMERCIAL_WEDGE_SPEC` is the priced product definition:
  $19/mo + $2/batch, with an explicit `killCriteria` — trailing-30-day ROI
  < 1.5x after 50 attempts with zero conversions.
- **`src/fee-recovery.js`** — classifies fee anomalies via median absolute
  deviation of the account's *own* historical rates (`MAD_MULTIPLIER = 3`),
  replacing an earlier fixed "1% above median" rule and a 50¢ noise floor
  (now `NOISE_FLOOR_CENTS = 1`, individually notable only above 50¢).
  Classifies cause by keyword (`interchange_downgrade`, `cross_border`,
  `refund_fee_retained`, `dispute_fee`, `unexplained`) and never asserts a
  recovery — only ever "amount in question." Rejects counterfactual billing
  ("we prevented an error") as unbillable because unverifiable.

## 5. Rails — venue adapters, and the ones already killed

A **rail** (`src/rails/base.js`, `RailAdapter`) is a payment/task venue
adapter with a `mode` (`READ_ONLY` vs `EXECUTE`) and an
`assertExecutable()` guard. `registry.js` is a simple register/get/list/
setMode map. Implementations (`bounty-scraper-rail.js`, `taskforce.js`,
`taskmarket.js`, `deskcrew.js`, `ugig.js`) do strict validation of the
venue's real API responses — no fabricated fields — and score opportunities
via `economic-selector.js`.

**`src/rails/dead-rails.js` — already tried, already rejected, seeded
DISABLED and never auto-re-enabled:**

- `taskforce` — disabled. Agent-work marketplaces measured at ~2 settled
  payouts/30 days industry-wide (Sept 2026); 0 of 529 open Algora bounties
  passed eligibility + freshness filters.
- `moltjobs` — disabled. 7 open jobs at $5 each, $0 ever paid to the tester.

`orchestration-profiles.js` separately records two removed *discovery
sources* (not rails, but the same lesson): `structural_money_flow` (the
system reading its own prior output as if it were new signal) and
`model_inference` (an LLM originating candidates from nothing) — both
removed because "discovery must be deterministic, and a source that reads
the system's own prior output is not a source."

## 6. Economic scoring and throttling

- **`src/economic-selector.js`** — `calculateExpectedNetValue` = composite
  probability (`pEligible × pClaim × pAccept × pPayout`) × grossReward ×
  workerShare − (upfrontFee + aiToolCost + platformFee + riskReserve).
  Decisions (`ENTER` / `SETUP_REQUIRED` / `BLOCKED` / `SKIP` /
  `NEEDS_EVIDENCE`) are gated by capability status, evidence freshness
  (max age 5 min), and a floor of `adjustedEv ≥ minExpectedNetValue (0.05)`.
  Adjusted EV multiplies raw EV by a `sourceWeight` (0.1–2.0) and a
  corroboration bonus (+10%/extra source, capped at 1.4x at 5 sources).
  `bundleMicroOpportunities` groups sub-$10 items by rail if ≥3 exist.
- **`src/qualification-engine.js`** — `qualifyCandidate` scores 0–10 against
  profile-specific weights/threshold; hard-gate metrics must be ≥0.5; each
  gate verdict must cite a real `evidenceRef` that actually exists in the
  candidate's evidence list — an unbound or stale citation is rejected.
- **`src/rail-governor.js`** — 4-state machine: PROBATION→PROVEN on first
  cleared settlement; PROBATION→DISABLED on budget/attempt exhaustion with
  zero settlements; PROVEN→SCALED at ≥10 lifetime cleared settlements and
  lifetime ROI ≥ 3.0; PROVEN→PROBATION if trailing-30d ROI < 1.0;
  SCALED→PROVEN if lifetime ROI drops below 2.0; DISABLED only exits via
  manual `setRailEnabled` (never automatic). Global monthly budget cap via
  `GLOBAL_MONTHLY_BUDGET_CENTS` (default $500).

## 7. Discover → Validate → Execute pipeline

`src/orchestration-profiles.js` defines `CANONICAL_QUEUES` (candidate_queue,
validation_queue, execution_queue, economic_outcomes, learning_inference,
actionable_work) and three `QUALIFICATION_PROFILES` with distinct
weight/threshold vectors: `programmable_money_flow_v1` (threshold 7.4, 8
gates), `bounty_execution_v1` (threshold 7.0, 11 gates),
`immediate_income_v1` (threshold 7.2, 7 gates).

- `src/workers/discover.js` — pulls only from explicit sample candidates,
  currently-enabled rails, and `@taskman/core` drones. Explicit invariant:
  **"NEVER fabricate candidates."**
- `src/workers/validate.js` — the sole promotion boundary from
  candidate_queue → execution_queue. AI-assisted evidence runs through
  `runAdversarialValidation`, which rejects a gate verdict that cites itself
  as its own evidence.
- `src/workers/execute.js` — outcomes classify as ADVANCED / COMPLETED /
  VALUE_CREATED / MONEY_EVENT / SETUP_REQUIRED / BLOCKED / REVALIDATE /
  REJECTED. Explicit invariant: **never simulate VALUE_CREATED or
  MONEY_EVENT** — `estimatedValue` is never realized value; only a
  ledger-verified settlement (§2) counts as money.

## 8. Storage and migrations — `src/revenue-store.js`, `packages/db/`, `db/`

Dual storage: an in-memory `Map` per queue, or Postgres, behind one function
surface gated by `databaseEnabled`. Dedup/idempotency is via `noveltyKey` —
memory mode does a linear `findIndex`; Postgres uses
`ON CONFLICT (queue, novelty_key) WHERE novelty_key IS NOT NULL`. Claiming
uses `FOR UPDATE SKIP LOCKED` in Postgres for concurrent-safe work claiming
(memory mode simulates it with a synchronous filter).

Two migration sets share one `schema_migrations` table (`packages/db/`,
numbered 007–032, and `db/`, numbered 001–023). Notable tables: `settlements`,
`rail_attempts`, `rail_state`, `revenue_records`, `income_streams`,
`bounty_candidates`, `bounty_triage_records`, `vuln_target_map`,
`customer_workspaces`, `customer_reconciliation_artifacts`,
`billing_accounts` / `billing_plans` / `billable_metrics`, `mutation_ledger`,
`knowledge_events`/`knowledge_snapshots`, `strategic_directives`/
`strategic_objectives`. `test/schema-code-agreement.test.js` is the guard
against code writing a value the schema rejects — it only runs with
`DATABASE_URL` set; memory-mode-only test runs do not exercise it.

## 9. Idempotency and verification

- **`src/settlement-verifier.js`** — pulls real Stripe `balance_transactions`
  (GET-only, never moves money), maps `status === 'available'` → CLEARED,
  else PENDING; skips non-positive amounts (refunds).
- **`src/idempotency-ledger.js`** — `claimIdempotencyKey` hashes the request
  body (`canonicalRequestHash`, sorted-key JSON) and stores per
  `(scope, route, keyHash)`; replays a completed response for a repeat call,
  detects a conflicting body reusing the same key, TTL-bounded (default 24h,
  min 1 min, max 7 days).
- **`src/idempotency-http.js`** — wraps the above for HTTP routes via an
  `Idempotency-Key` header; fails the claim outright (rather than leaving it
  phantom) if the handler throws before completing.

## 10. Customer / demand model

- **`src/customer-profile.js`** — `FIRST_PAYING_CUSTOMER_PROFILE`: boutique
  Fiverr agencies doing >$3,000/mo, current workaround cost ~$250/mo of
  manual Excel reconciliation, target price $19/mo + $2/batch,
  `minimumRoiMultiple: 3.0`. Lists explicit prospect channels
  (r/Fiverr, Fiverr forums, Fiverr Top-Rated Sellers FB group, etc.).
- **`src/acquisition-funnel.js`** — `FUNNEL_STAGES`: PROSPECT_SOURCED →
  CONTACTED → QUALIFIED → DEMO_TRIAL → VALUE_PROVEN → PAID → RETAINED →
  REFERRAL.
- **`src/customer-workflow.js`** — INACTIVE→ACTIVE state machine requiring
  configured inputs plus connected integrations (Fiverr statements, bank
  deposits, Stripe billing) before reconciliation runs. This three-gate
  requirement is exactly what §4's `instant-audit.js` was built to route
  around for first contact.

## 11. Billing / fulfillment

- **`src/value-billing.js`** — `BILLING_RULES`: hybrid pricing, $19/mo base
  + $2/batch + 5% of verified recovered leakage capped at $50/mo
  (`MAX_MONTHLY_PERFORMANCE_FEE_CENTS`). Requires a `hashed_audit_report` at
  `VERIFIED_CRYPTOGRAPHIC_AUDIT` evidence level before invoicing.
  `INVOICEABLE_STATUSES`: DRAFT → PENDING_CUSTOMER_APPROVAL → INVOICEABLE →
  INVOICED → PAID / DISPUTED / CREDITED / REFUNDED.
- Note: the audit-lane skill (`.claude/skills/taskman-audit-lane/`) states
  the *live, currently-priced* model is **20% contingency of confirmed
  recovery, not a flat fee** — collected via `paypal.me/joyelgt` (the
  `/20USD` suffix is a leftover from an earlier flat-fee model and should
  not be used for a contingency invoice). Treat the live skill/CLAUDE.md
  pricing as authoritative over `BILLING_RULES` if the two ever diverge —
  `BILLING_RULES` reads as an earlier or parallel pricing model.
- `src/audit-fulfilment.js` / `src/scan-fulfilment.js` — order-to-report
  fulfillment plumbing tied to the reconciliation output; not independently
  verified beyond their existence and rough size in this pass.

## 12. AI / LLM orchestration layer

- **`src/reasoning-engine.js`** — `ReasoningEngine.reason()` dispatches
  across a provider fallback chain, strips `<think>` tags and code fences,
  parses JSON, and validates against a named schema
  (`src/reasoning-schemas.js`). Hard-fails with `MODEL_OUTPUT_INVALID`
  rather than guessing on malformed output. `synthesizeDiscovery` carries an
  explicit "Do NOT fabricate sources" instruction in its prompt.
- **`src/ai-engine/money-making-agent.js`** — `MONEY_DOMAINS`
  (OPPORTUNITY_TRIAGE, FEE_LEAKAGE_AUDIT, CANDIDATE_DELIVERABLE,
  MARKET_ARBITRAGE), each with its own system prompt and required JSON
  schema. `evaluateMoneyAiOutput` is the deterministic validator — for
  OPPORTUNITY_TRIAGE it rejects any `decision` outside
  `['ENTER','REJECT','NEEDS_EVIDENCE']` and defensively coerces
  numeric/boolean/array fields rather than trusting the model output.
- **`src/model-router.js`** — 4-tier cost model (TIER_0 = $0 deterministic,
  TIER_1 ≈ $0.0001, TIER_2 ≈ $0.0005, TIER_3 ≈ $0.005) with a default-tier
  map by task type (normalization → TIER_0; extraction/classification →
  TIER_1; evidence synthesis / adversarial validation / code generation →
  TIER_2) — routes each task to the cheapest model sufficient for it.

## 13. Learning / knowledge layer

- **`src/knowledge-store.js`** — append-only event store (file-backed or
  Postgres) of typed observations, each carrying `confidence` and
  `sourceType`.
- **`src/learning-inference.js`** — classifies an inference as
  `TEMPORARY_HINT` vs `DURABLE_RULE`. Durable requires confidence ≥ 0.8 and
  ≥ 3 corroborating evidence instances; hints expire after 7 days. Also
  grades past guidance as USEFUL / MISLEADING / INCONCLUSIVE against real
  outcomes — i.e. the system is meant to mark its own prior advice wrong
  when reality disagrees with it.
- **`src/structured-learning.js`** — constrains every learning record's
  `type` to a fixed enum: `fact`, `assumption`, `rejection`, `gap_opened`,
  `gap_resolved`, `future_path`, `money_event`. This is the schema that
  produces the "rejection" records that feed the disproof registry below.
- **`src/learning/dataset-builder.js`** — builds DPO-style (chosen/rejected)
  training pairs from `response` vs `rejectedResponse`, scored by
  `outcomeScore`.

## 14. Disproof registry — read this before trying anything "new"

**`packages/core/territory/registry.js`** — `EXPLORED_TERRITORIES`, each
tagged ACTIVE / UNPROVEN / KILLED, with `isNovel()` rejecting both exact
repeats and declared aliases of killed lanes:

| Key | Verdict | Why |
|---|---|---|
| `github-bounty-hunt` | ACTIVE | Picked clean: 403 listings → 0 winnable once assigned/contested/hardware-gated filters apply. |
| `oss-vuln-sweep` | ACTIVE | Static CWE-22/78/918 scan, PoC-gated. No payable bug found yet in hardened flagships. |
| `audit-tool-contingency` | ACTIVE | Live and priced. Bottleneck is inbound demand, not code. |
| `huntr-oss` | ACTIVE | Profile verified, payout via Stripe Connect Express (reaches most countries). |
| `fiverr-ai-debug-gig` | ACTIVE | Operator-run; needs human KYC and delivery. |
| `hackerone-bugcrowd-source-scope` | UNPROVEN | Only the sliver of programs with public source in scope fits a static scanner. |
| `defi-arbitrage` | **KILLED** | Loses money on failed attempts; spread taken by colocated searchers before a public RPC even answers. |
| `hn-ranking-dataset` | **KILLED** | No moat — the publisher (HN) archives the exact front-page list since 2014; two free mirrors exist too. See §note below. |
| `agent-economy-marketplaces` | **KILLED** | ~73% prompt-exfiltration honeypots measured; ~2–5 of 232 listings real; crypto-only rails. |
| `algora-bounties` | **KILLED** | Terms prohibit robotic/automated access — holds regardless of country; the payment rail itself is fine almost everywhere. |
| `taskforce-moltjobs` | **KILLED** | Effectively zero settled volume measured. Shipped DISABLED. |

Note on `hn-ranking-dataset`: this is the concrete case the whole
`taskman-verify` discipline is built around. A data source was marked
"Verified — no historical archive exists" without anyone checking; it took
ten minutes of actually reading published sources to find HN's own archive
plus two independent free mirrors, ending a lane that had been judged 364
days from sellable. **Marking something "verified" without checking the
underlying source is how this project nearly lost a year.**

**`packages/core/income/defaults.js`** — `DEFAULT_STREAMS`, each tagged
DISPROVEN / BLOCKED / TESTING / HYPOTHESIS with `unblockedBy`
(machine-fixable vs. human-only):

- `agent-task-boards` (TaskForce/MoltJobs) — **DISPROVEN**, near-zero
  settled volume industry-wide (Sept 2026); matches `dead-rails.js`.
- `fiverr-bookkeeping` — **BLOCKED** (human-only KYC); demand search found
  no stated budgets and a free incumbent feature covering bookkeeping, so
  intent pivoted to "AI-code debugging" gigs instead ($25–50, live demand).
- `payout-leakage-audit` — **BLOCKED**: software is ready; the missing
  input is one trusting client — a machine cannot originate a trusted
  relationship on its own.
- `payout-audit-direct` — **TESTING**, currently the strongest live lane
  (public audit + PayPal/Stripe link) — the deliberate fix for the
  three-gate signup wall described in §4/§10.
- `github-paid-bounties` (Algora) — **BLOCKED** on human Stripe Express KYC;
  explicit note: *"PayPal does NOT unlock Algora."*
- `ephemeral-attention-dataset` — **DISPROVEN** 2026-09-05 — see the HN
  ranking note above; this is the same disproof recorded from the income
  side.
- `venue-reachability-record` — **HYPOTHESIS**, accrues free as a byproduct
  of the satellite scan, never separately tested on its own.

**`packages/core/income/venues.js`** — reachability model:
`isReachable(venue, {country})` fails closed on any of: platform-rejected,
does-not-pay-to-country, requires-registered-business-entity, or
agent-policy-prohibited. Records that job *volume* is the most encouraging
and least predictive signal — DeFi arbitrage passes every reachability
check (pays to India, no entity required, agents welcomed) and is still a
bad lane because of execution economics, which is exactly why reachability
alone is insufficient and `killCriteria`/ROI checks exist separately.
Verified vs. assumed rail costs are tracked per country (e.g. PayPal India:
4.4% + fixed fee + 3–4% FX markup, verified 2026-09-06; India VDA crypto tax
30% flat + 1% TDS, assumed not re-checked).

**`packages/core/observations/sources.js`** — at least one prior data
source is kept in code but disabled, rather than deleted, specifically "so
the disproof stays attached to the thing it disproves." Apply this pattern
generally: never delete a killed lane's code/record, disable it in place.

## 15. Recent, concrete fabrication findings (2026-09-11) — apply these tests going forward

These were found by directly checking claims against the filesystem, not by
trusting a summary — exactly the `taskman-verify` discipline this project
already commits to.

- **`src/autonomous-engine.js`'s `OPPORTUNITY_FEED`** (5 hardcoded entries:
  `bounty-algora-101`, `bounty-fiverr-audit-201`, `bounty-algora-102`,
  `bounty-dispute-chargeback-301`, `bounty-api-rate-limiter-401`) had no
  real counterparty behind any entry. Generic `source` labels
  ("Algora / GitHub OSS Bounty") stood in for a real listing URL/ID in every
  case.
- `bounty-fiverr-audit-201` traced to `scripts/complete-fiverr-audit-
  settlement.js`, which generates its own fake 120-order dataset in code and
  hardcodes `payoutStatus: 'CLEARED'` with no PayPal check, no bank
  confirmation, and no real `settlements` row (§2's invariant was bypassed
  by writing a raw JSON file instead of calling `recordSettlement`). The
  client name "Apex Digital Creative" exists nowhere except as a string this
  script invented.
- `bounty-algora-101` / `-102` had real, tested code behind them
  (`src/stripe-webhook-mutex.js`, `src/accessibility-calendar-tokens.js` —
  both pass their real test files) but referenced a nonexistent
  `solutions/<id>.js` path and had never been submitted to any real bounty.
  **Status corrected 2026-09-11.** This entry previously claimed
  `_executeDeliverableTrial` "runs `node --test <testFile>` for real". **It did
  not.** It called `existsSync()` on the patch and test files and set
  `testsPassed = true` if both merely existed — so a test file that existed and
  FAILED still staged as `TESTED_AND_READY`. The document asserted a fix that
  was not in the code: the exact failure this project is built to prevent,
  committed in the document written to prevent it.

  **Now genuinely fixed**: `verifyDeliverableTests()` (exported from
  `src/autonomous-engine.js`, covered by `test/deliverable-test-verification.
  test.js`) spawns `node --test <testFile>` and reads the exit code. Verdicts:
  `PENDING_IMPLEMENTATION` (no patch), `UNTESTED` (patch, no test),
  `TESTS_FAILING` (suite ran and failed), `TEST_RUN_FAILED` (suite could not be
  spawned), `TESTED_AND_READY` (suite ran and passed). A `ran` flag
  distinguishes "tests failed" from "tests never ran".

  Two traps found while fixing it, both worth knowing: the field is
  `patchFile`, not `sourceFile`; and the spawned child must NOT inherit
  `NODE_TEST_CONTEXT`, which a parent `node --test` run sets and which makes a
  failing child suite report success — a naive fix reintroduces the bug
  whenever the engine is exercised from a test.
- `bounty-dispute-chargeback-301` and `bounty-api-rate-limiter-401` had
  `testsPassed: true` hardcoded with **no source file anywhere in `src/`**
  — a fabricated status flag, not just unvalidated demand. **Fixed** (verified
  2026-09-11): a candidate with no `patchFile` stages as `testsPassed: false`
  with `patchFile: null`. The status string is `PENDING_IMPLEMENTATION`, not
  the `NO_IMPLEMENTATION` this document previously named. The 40 stale staged-deliverable
  JSON files asserting the old false claim were deleted from
  `data/staged-deliverables/` (that directory is gitignored going forward).

**Rule for the new brain**: `testsPassed: true` or `status: 'TESTED_AND_
READY'` must never be set without an actual test run against an actual
source file that exists on disk. If you find code doing this again, it is
the same bug recurring — fix at the source, not by patching the output.

---

## 16. The four failure shapes, and why a rule is not enough

Every incident in §14 and §15 is one of four things. Learn them by name; they
are separate bugs that reinforce each other.

1. **The indicator is not the thing** (Goodhart's law; specification gaming).
   A proxy stands in for the property and the code optimises the proxy —
   `existsSync` standing in for a test run.
2. **The vacuous test.** An assertion with no discriminating power: it passes
   identically whether the code is right or wrong.
3. **Confabulation.** A confident claim with no underlying check — including
   §15 of this document, which asserted a `node --test` fix that was not in the
   code.
4. **Surrogation.** Enforcing a rule's letter against its intent — §1's earlier
   hard reference gate, which would have blocked discovery in the name of
   preventing fabrication.

The uncomfortable lesson: this repo already carried `taskman-verify`, a
`CLAUDE.md` rule to verify before asserting, and this document — whose whole
thesis is that unverified "verified" marks nearly cost a year. All four
happened anyway, and two of them happened *while fixing another one*. A rule
you must remember to apply does not fire in the state where you are confident,
and confidence is the state in which these get written.

So prefer, in this order:

1. **An executable check** that fails whether or not anyone remembered —
   `verifyDeliverableTests()`, `test/schema-code-agreement.test.js`, a CI scan.
2. **A broken-then-restored demonstration** recorded in the commit: break the
   guarded property, watch the test fail, restore, keep both outputs.
3. **A written rule**, last, because it is the weakest of the three.

The procedure and the discriminating-guard checklist live in the
`verifying-guard-tests` skill (`.claude/skills/`), reachable also from
`taskman-verify`.

---

## How to keep this document honest

When you (the new brain) add a rail, a candidate source, a pricing rule, or
close out a lane, update this file in the same commit — the disproof
registries above (§14) are the load-bearing pattern: a killed lane is
recorded *with its reason*, never deleted, so it cannot be silently
rediscovered and re-tried next quarter under a new name. Follow the same
practice here.
