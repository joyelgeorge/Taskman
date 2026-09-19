# Parked tasks

Work that was found but deliberately not done, so it can be picked up later
instead of blocking whoever found it.

## Open, by priority

Two questions set priority. **Which settlement row does this produce, and who
pays it?** (`docs/READ-FIRST.md`), and then, between lanes that could both
produce one: **who will say yes without a sales conversation?**

The second question was adopted on 2026-09-14. It replaced "sort by revenue
ceiling" and "sort by how autonomous the loop is", both of which produced
finished machinery and no revenue.

Every task below is labelled with the progress level it targets. Only level 1 is
the goal. **Revenue work outranks everything in the Architecture section, and
that remains true however interesting the architecture is.**

### P0 — warm distribution, the constraint that has blocked every lane

- **[Tally duplicate-invoice / shrinkage detector](2026-09-14-tally-duplicate-invoice-detector.md)** — *level 1*
  The first wedge where the trusted relationship is claimed to **already exist** —
  one real retailer, no cold outreach. **Verify the access claim before building:
  it is one question to the operator and the entire P0 rests on it.**

### P1

- **[GST input-credit mismatch detector](2026-09-14-tally-gst-input-credit-mismatch.md)** — *level 1*
  Listed P0 in the source discussion; demoted for a crowded category and the
  liability a filing draft carries.
- **[GitHub Marketplace CI Action](2026-09-18-github-marketplace-ci-action.md)** — *level 1*
  Opened 2026-09-18 from a `/revenue-discovery` pass, scored 0.75 — highest of
  five new distribution candidates. The vibe-app-security detectors, already
  built, pointed at a standing marketplace instead of cold outreach.
- **[Cyber-insurance referral off real scan findings](2026-09-18-cyber-insurance-referral.md)** — *level 1*
  Scored 0.73, but only inside an already-warm disclosure — additive to
  vibe-app-security, not a standalone lane. Cheapest possible test of anything
  opened today: one extra sentence in the next disclosure sent.
- **[NPM postinstall/preinstall curl-pipe-to-bash detector](2026-09-18-npm-postinstall-supply-chain-detector.md)** — *level 4*
  Capability, not distribution, but prioritised above its two sibling
  detectors because a product (below) is blocked on it.
- **[Firebase Firestore/Realtime DB open-rules detector](2026-09-18-firebase-open-rules-detector.md)** — *level 4*
  Opened 2026-09-18 from `/expanding-the-search`. CLAUDE.md's critical finding
  names Firebase alongside Supabase as the target market; every detector built
  so far only covers Supabase. Closes a gap in the bet already made, not a new one.

### P2 — the cold-scan funnel

- **[Package the Tally wedge as a repeatable install](2026-09-14-package-tally-wedge-as-repeatable-install.md)** — *level 1*
  Blocked on the first wedge producing a settlement, not a demo.
- **[Mobile app (APK/IPA) hardcoded-secret extraction](2026-09-18-mobile-app-secret-extraction.md)** — *level 4*
  Opened 2026-09-18 from `/expanding-the-search`. New surface, not new
  detection logic — existing `findExposedSecret` patterns apply once a binary
  is unzipped. Unlike Firebase, mobile isn't in CLAUDE.md's named target
  market — real widening into unproven territory, priced accordingly below
  the Firebase detector.
- **[Package pre-flight risk check — CLI + API](2026-09-18-package-preflight-risk-product.md)** — *level 1*
  Scored 0.69. Blocked on the postinstall detector above.
- **["Secure-by-default" Supabase/Next.js starter template](2026-09-18-secure-by-default-starter-template.md)** — *level 1*
  Scored 0.65. Unusually cheap fulfilment (a repo, not a service) and
  unusually easy to kill for free (publish free first, see if anyone clones it).
- **[Next.js Server Action auth-absence detector](2026-09-18-nextjs-server-action-auth-detector.md)** — *level 4*
  Widens vibe-app-security's scan coverage; doesn't touch its actual
  bottleneck (reply rate on disclosures already sent).
- **[Stripe checkout tampering / webhook-verification detector](2026-09-18-stripe-checkout-tampering-detector.md)** — *level 4*
  Same reasoning as the Server Action detector above.

### Architecture — accumulate, don't re-derive (all level 4)

Phases of `docs/superpowers/specs/2026-09-15-accumulating-architecture-design.md`.
**Phase 0 is built** — `npm run brief`, `src/store-state.js`, and
`settlementPosition()`. A session with no `DATABASE_URL` can no longer be told
the revenue is zero.

- **[The Rails: Typed execution DAGs and hermetic tool contracts](2026-09-16-typed-execution-dags-and-hermetic-rails.md)** — *level 4*
  Schema-enforced OpenAPI/JSONSchema boundaries and topological DAG execution in `runner.js`.
- **[The Creative Engine: Orthogonal candidate generator](2026-09-16-orthogonal-hypothesis-generator.md)** — *level 4*
  Parallel contrasting generation pipelines (adversarial taint vs. defensive auth wrappers) with deterministic AST symbolic pruning.
- **[The Bridge: Contract compiler and shadow execution](2026-09-16-contract-compiler-and-shadow-execution.md)** — *level 4*
  Plan-to-DAG compiler, sandbox shadow execution, and hard human-in-the-loop gates for high-consequence state shifts.


### P3 — parked, with stated revisit conditions


- **[The four deprioritized recovery wedges](2026-09-14-deprioritized-recovery-wedges.md)**
  Stripe recovery, unused seats, silent renewals, EMI overcharge. All buildable,
  all blocked on credibility with strangers.
- **[Vulnerability-class rules pack for AI coding assistants](2026-09-18-ai-assistant-rules-pack.md)** — *level 1*
  Scored 0.50, capped on distribution — no confirmed paid marketplace for
  Cursor/Claude-skill rules files. Blocked pending that one check, not on build effort.

### Maintenance — label it as such


## Closed

- ~~`income_streams` had drifted from `registry.js`~~ — corrected 2026-09-19.
  `defi-flashloan-arbitrage` (alias of the already-`KILLED` `defi-arbitrage`)
  and `github-paid-bounties` (disagreed with `registry.js`'s Algora `KILLED`
  verdict) moved to `DISPROVEN`; `decentralized-gpu-inference` and
  `depin-bandwidth-sharing` moved to `HYPOTHESIS` pending real evidence, since
  demoting an unevidenced claim isn't the same as disproving it.
  `payout-audit-direct`'s `mechanism`/`requires`/`nextAction` corrected to the
  live PayPal-contingency reality and moved `BLOCKED` → `TESTING`. Along the
  way, fixed the actual bug that let the drift happen:
  `registerStream()`'s re-seed path refreshed `mechanism`/`requires` but not
  `nextAction` (DB mode) and refreshed nothing at all (memory mode) — both
  now consistently refresh `title`/`mechanism`/`requires`/`nextAction` while
  still protecting `state`/`stateReason`/`evidence`, with a test covering it
  (`packages/core/test/income.test.js`). The `revenue-hunt` skill's Lane B
  section corrected to say Algora is killed rather than an active lane.

- ~~Wedges needing a licensed human~~ — closed out of the active queue. It is a
  kill-note (healthcare, legal, manufacturing, construction — detection tractable,
  fulfilment needs a licensed human), and that verdict now lives permanently in
  `packages/core/territory/registry.js` as `licensed-human-verticals`, which is
  where a discovery run will meet it. A kill-note does not need to sit among open
  work.

- ~~The deliverable-staging test fails intermittently~~ — root cause was a fixed
  shared on-disk staging directory (`data/staged-deliverables/`) used by a
  stateful engine with existence checks, raced across the parallel test
  processes `node --test` spawns. `stagedDir` is now injectable (production
  default unchanged) and each test gets an isolated temp dir. 8 of 8 full-suite
  runs green, where the flake previously showed at ~1 in 6. The assertion was
  not relaxed.

- ~~Ten more storage-divergence reads~~ — **decided: documented, not migrated**,
  the branch the task allowed. Verified both reporting surfaces (brief, next)
  read through the store-state vocabulary, so no reported number comes from a raw
  memory read. The convenience reads no session quotes are documented in
  money-ledger.js as memory-mode-only; converting them would churn asserted
  return shapes for no live risk.

- ~~The primary lead engine is not running~~ — **automated** (option 1). `npm run
  warm-scout` searches GitHub for people asking for help securing their app,
  persists the open threads as warm leads flagged for human read, and a daily
  cron runs it. A live run surfaced 65 real warm-intent threads. The reply and
  the intent-judgement stay human, which is correct; the discovery no longer does.

- ~~Lead drones have no dedupe~~ — `runLeadDrone` now reads existing leads for
  the campaign, keys them by a signal's url (falling back to title), and skips
  ones already seen, across flights and within one flight. Mirrors the scan
  path's dedupe. Verified by mutation.

- ~~Is public GitHub the right surface?~~ — answered. Repo scanning works but is
  the small, closing surface: 4 exposed secrets from 199 candidates, and the
  keys it finds are being auto-revoked by Supabase's GitHub partnership. Deployed
  bundles are ~50x the hit rate (11% of 20,052 URLs) and immune to that
  revocation. See docs/research/2026-09-15-is-this-lane-worth-48-more-attempts.md.
- ~~Scan deployed bundles, not GitHub repos~~ — built: `packages/core/jobs/bundle-scan.js`
  fetches a deployed app and runs the existing secret detector over its JS,
  flagging service_role and never anon. Target-list sourcing from indie-launch
  directories is the remaining operator step, not code.

- ~~`findUnauthenticatedAdminRoutes` reports guarded routes as unauthenticated~~ —
  it missed guards delegated to a named helper. Fixed and mutation-tested; the
  re-audit cleared 10 false positives across two repos and confirmed a real
  auth bypass in a third that the noise had been hiding.

- ~~Refactor fulfilment onto the job contract~~ — **closed as not worth it**, the
  outcome the task explicitly allowed. `vibe-app-security` proves the contract
  against a real lane without touching `audit-fulfilment` or `scan-fulfilment`,
  which remain the only two finished settlement paths and have never run in
  production. The contract is worth less than the paths.

- ~~Claim–reality agreement tests~~ — `test/claim-reality-agreement.test.js`
  checks the settlement-path count and names, every file and npm script the
  trusted docs point at, and the advertised test count, each against the
  filesystem rather than a cached summary. It immediately caught real drift: the
  job runner had made READ-FIRST's "six code paths" wrong. The ledger assertion
  is opt-in via `TASKMAN_VERIFY_LEDGER=1`, because CI's throwaway database is
  empty by construction and would have made it a test of nothing.

- ~~The revenue-job runner and its four gates~~ — `packages/core/jobs/runner.js`,
  `src/job-run-log.js`, migration `036_job_runs.sql`. All four gates verified by
  removing them. The gate-4 ordering test was vacuous on first write — it passed
  when the log was made fire-and-forget — and now uses a genuinely slow log so it
  can fail.

- ~~Job descriptors and a distribution scorer~~ — `packages/core/jobs/job-spec.js`
  holds the shape, the registry holds the data, and `scoring.js` now weights
  distribution at 0.35 with a `relationship_exists` label it previously could not
  express. Proven by mutation: the old weight, a missing label, a cold lane made
  fatal, a job charging without verify, and a lane given a flattering label each
  turn a test red.

- ~~Research notes and countable tasks~~ — `research_notes` (migration 035) plus
  `npm run research`, and task front matter with a generated index block that a
  test compares against the files. Proven by mutation: stripping a file's front
  matter, adding an unindexed task, and making the parser drop what it cannot
  read each turn a test red.

- ~~`listSettlements` cannot tell "no money" from "no database"~~ — `src/store-state.js`
  gives reads a `verified / empty / unknown` state, and `settlementPosition()`
  uses it. Proven by mutation: reinstating the empty-array fallback turns the
  test red.
- ~~`npm run brief` reconstructs the position~~ — built, wired into `CLAUDE.md`
  and `READ-FIRST.md`, exits non-zero on an unreachable store.

- ~~Star filter selects against businesses~~ — removed; the search now sorts by
  `updated` and the pool went from 25 reachable repos to 199 candidates.
- ~~One search query returns zero~~ — deleted, and a zero-result query now warns
  loudly instead of contributing nothing in silence.
- ~~Candidate cap is 75 against a 1,000 pool~~ — paginates to a stated
  `CANDIDATE_BUDGET = 120` with the pool sizes recorded in the source.
- ~~No outreach attempt is ever counted~~ — `src/outreach-log.js`, migration
  `034_outreach_attempts.sql`, `npm run outreach`, and a 50-attempt kill
  criterion that can now actually fire.
- ~~Verify the CI database is migrated~~ — proven by run
  [34857396120](https://github.com/joyelgeorge/Taskman/actions/runs/34857396120):
  migrations applied and `persisted: 5 new`.

## Every task file, counted

Generated by `npm run tasks` from the front matter in each file. The curated
sections above are written by hand; this one exists so that nothing can quietly
fall out of the list, which the section below warns about and which has happened.

<!-- generated:tasks -->
_19 open, 0 done, 19 task files._

| Task | Status | Priority | Level |
| --- | --- | --- | --- |
| [The four deprioritized recovery wedges (Stripe, seats, renewals, EMI)](2026-09-14-deprioritized-recovery-wedges.md) | blocked | P3 | 1 |
| [Package the Tally wedge as a repeatable install](2026-09-14-package-tally-wedge-as-repeatable-install.md) | blocked | P2 | 1 |
| [Tally duplicate-invoice / shrinkage detector — the first warm-distribution wedge](2026-09-14-tally-duplicate-invoice-detector.md) | open | P0 | 1 |
| [GST input-credit mismatch detector (Tally, second variant)](2026-09-14-tally-gst-input-credit-mismatch.md) | open | P1 | 1 |
| [The Bridge: Contract compiler, shadow execution, and human gatekeeper](2026-09-16-contract-compiler-and-shadow-execution.md) | open | P2 | 4 |
| [The Creative Engine: Orthogonal candidate generator with symbolic pruning](2026-09-16-orthogonal-hypothesis-generator.md) | open | P2 | 4 |
| [Remove the scanner test fixture after the pay→unlock test](2026-09-16-remove-scanner-test-fixture.md) | open | P2 | 4 |
| [Ship the self-serve scanner: endpoint, checkout, launch](2026-09-16-self-serve-scanner-plumbing.md) | open | P1 | 1 |
| [The Rails: Typed execution DAGs and hermetic tool contracts](2026-09-16-typed-execution-dags-and-hermetic-rails.md) | open | P2 | 4 |
| [Vulnerability-class rules pack for AI coding assistants](2026-09-18-ai-assistant-rules-pack.md) | blocked | P3 | 1 |
| [Cyber-insurance referral off real scan findings](2026-09-18-cyber-insurance-referral.md) | open | P1 | 1 |
| [Firebase Firestore/Realtime DB open-rules detector](2026-09-18-firebase-open-rules-detector.md) | open | P1 | 4 |
| [GitHub Marketplace CI Action — continuous scan instead of one-off audit](2026-09-18-github-marketplace-ci-action.md) | open | P1 | 1 |
| [Mobile app (APK/IPA) hardcoded-secret extraction — new surface, not new logic](2026-09-18-mobile-app-secret-extraction.md) | open | P2 | 4 |
| [Next.js Server Action auth-absence detector](2026-09-18-nextjs-server-action-auth-detector.md) | open | P2 | 4 |
| [NPM postinstall/preinstall curl-pipe-to-bash detector](2026-09-18-npm-postinstall-supply-chain-detector.md) | open | P1 | 4 |
| [Package pre-flight risk check — CLI + API product](2026-09-18-package-preflight-risk-product.md) | blocked | P2 | 1 |
| ["Secure-by-default" Supabase/Next.js starter template](2026-09-18-secure-by-default-starter-template.md) | open | P2 | 1 |
| [Stripe client-side price-tampering / missing-webhook-verification detector](2026-09-18-stripe-checkout-tampering-detector.md) | open | P2 | 4 |
<!-- /generated:tasks -->

## Writing one

Write a task here when another session is mid-edit in a file you need, when you
find a real problem outside the job you are doing, or when a change needs a
decision that is not yours — pricing, outreach, anything that spends money or
contacts a person.

One file per task, named `YYYY-MM-DD-short-slug.md`. Say what you found, where it
is, why it was not done now, and what "done" would look like. Enough that someone
picking it up cold does not have to re-derive it.

Delete the file in the commit that completes the task, and add it to the index
above when you create it; a parked task that is silently done is a task someone
will do twice.
