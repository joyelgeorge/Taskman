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

- **[The primary lead engine is not running](2026-09-12-primary-lead-engine-is-not-running.md)** — *level 2*
  `warm-lead-scout` is called the primary engine and has no cron, script or
  persistence. Warm inbound — the same principle that makes Tally P0.
- **[GST input-credit mismatch detector](2026-09-14-tally-gst-input-credit-mismatch.md)** — *level 1*
  Listed P0 in the source discussion; demoted for a crowded category and the
  liability a filing draft carries.

### P2 — the cold-scan funnel

- **[Is public GitHub the right surface?](2026-09-12-is-public-github-the-right-surface.md)** — *level 3*
  **Answered on yield** — 112 scanned, 27 leads, 19 with criticals. Its untested
  half is response rate, and its next step is a message from the operator, not
  code. Closes when one attempt is logged.
- **[Package the Tally wedge as a repeatable install](2026-09-14-package-tally-wedge-as-repeatable-install.md)** — *level 1*
  Blocked on the first wedge producing a settlement, not a demo.

### Architecture — accumulate, don't re-derive (all level 4)

Phases of `docs/superpowers/specs/2026-09-15-accumulating-architecture-design.md`.
**Phase 0 is built** — `npm run brief`, `src/store-state.js`, and
`settlementPosition()`. A session with no `DATABASE_URL` can no longer be told
the revenue is zero.


### P3 — parked, with stated revisit conditions

- **[Ten more storage-divergence sites](2026-09-15-remaining-storage-divergence-sites.md)**
  Phase 0 closed the revenue read. Ten `if (!databaseEnabled)` branches in the
  ledger still cannot say "I could not answer" — and we ship a scanner that
  flags exactly this pattern in other people's code.

- **[The four deprioritized recovery wedges](2026-09-14-deprioritized-recovery-wedges.md)**
  Stripe recovery, unused seats, silent renewals, EMI overcharge. All buildable,
  all blocked on credibility with strangers.
- **[Wedges needing a licensed human](2026-09-14-wedges-needing-a-licensed-human.md)**
  Healthcare, legal, manufacturing, construction. Killed on fulfilment, not
  market size.

### Maintenance — label it as such

- **[The deliverable-staging test fails intermittently](2026-09-14-deliverable-staging-test-is-intermittent.md)**
  Fails under the full suite, passes standalone. It guards the function that
  replaced `existsSync`-as-"tests passed".
- **[Lead drones have no dedupe](2026-09-12-lead-drones-have-no-dedupe.md)**

## Closed

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
_11 open, 0 done, 11 task files._

| Task | Status | Priority | Level |
| --- | --- | --- | --- |
| [Question the premise: are vibe-coded businesses even on public GitHub?](2026-09-12-is-public-github-the-right-surface.md) | open | P2 | 3 |
| [runLeadDrone creates duplicate leads on re-run](2026-09-12-lead-drones-have-no-dedupe.md) | open | P3 | 4 |
| [The primary lead engine is not running at all](2026-09-12-primary-lead-engine-is-not-running.md) | open | P1 | 2 |
| [The deliverable-staging test fails intermittently](2026-09-14-deliverable-staging-test-is-intermittent.md) | open | P3 | 4 |
| [The four deprioritized recovery wedges (Stripe, seats, renewals, EMI)](2026-09-14-deprioritized-recovery-wedges.md) | blocked | P3 | 1 |
| [Package the Tally wedge as a repeatable install](2026-09-14-package-tally-wedge-as-repeatable-install.md) | blocked | P2 | 1 |
| [Tally duplicate-invoice / shrinkage detector — the first warm-distribution wedge](2026-09-14-tally-duplicate-invoice-detector.md) | open | P0 | 1 |
| [GST input-credit mismatch detector (Tally, second variant)](2026-09-14-tally-gst-input-credit-mismatch.md) | open | P1 | 1 |
| [Parked wedge class: anything whose INTERVENE step needs a licensed human](2026-09-14-wedges-needing-a-licensed-human.md) | blocked | P3 | 4 |
| [Ten more reads still cannot say "I could not answer"](2026-09-15-remaining-storage-divergence-sites.md) | open | P3 | 4 |
| [Scan deployed bundles, not GitHub repos](2026-09-15-scan-deployed-bundles-not-repos.md) | open | P1 | 3 |
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
