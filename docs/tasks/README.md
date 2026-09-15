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

- **[Research notes and countable tasks](2026-09-15-research-notes-and-countable-tasks.md)** — phase 1
  A finding retrievable without its transcript; a generated task index.
- **[Job descriptors and a distribution scorer](2026-09-15-job-descriptors-and-distribution-scorer.md)** — phase 2
  `scoring.js` still encodes the *old* ranking and cannot express "a relationship
  already exists" at all.
- **[The revenue-job runner and its four gates](2026-09-15-revenue-job-runner-and-gates.md)** — phase 3
  Human, evidence, ledger, attempt. The attempt gate is what justifies it.
- **[Claim–reality agreement tests](2026-09-15-claim-reality-agreement-tests.md)** — phase 5
  Numbers our own documents assert, checked against the primary store.
- **[Refactor fulfilment onto the job contract](2026-09-15-refactor-fulfilment-onto-job-contract.md)** — phase 4, **do last**
  Touches the only two finished settlement paths. If it fights, stop.

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
