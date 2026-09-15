# Parked tasks

Work that was found but deliberately not done, so it can be picked up later
instead of blocking whoever found it.

## Open, by priority

Two questions set priority. **Which settlement row does this produce, and who
pays it?** (`docs/READ-FIRST.md`), and then, between lanes that could both
produce one: **who will say yes without a sales conversation?**

The second question was adopted on 2026-09-14 and reordered this list. It
replaced "sort by revenue ceiling" and "sort by how autonomous the loop is",
both of which produced finished machinery and no revenue.

### P0 — warm distribution, the constraint that has blocked every lane

- **[Tally duplicate-invoice / shrinkage detector](2026-09-14-tally-duplicate-invoice-detector.md)**
  The first wedge where the trusted relationship is claimed to **already exist** —
  one real retailer, no cold outreach. READ-FIRST names that as the load-bearing
  constraint nothing else has cleared. **Verify the access claim before building:
  it is one question to the operator and the entire P0 rests on it.**

### P1

- **[`listSettlements` cannot tell "no money" from "no database"](2026-09-15-empty-is-not-unknown.md)**
  A live correctness bug: with no `DATABASE_URL` the ledger returns `[]`, which
  is identical to a reachable database holding zero rows. Harmless only while
  the true answer is zero. Phase 0 of the accumulating-architecture spec.
- **[The primary lead engine is not running](2026-09-12-primary-lead-engine-is-not-running.md)**
  `warm-lead-scout` is called the primary engine and has no cron, no script and
  no persistence. Same principle as the Tally wedge — warm inbound beats cold —
  which is why it stays high even as the cold-scan funnel gets deprioritized.
- **[GST input-credit mismatch detector](2026-09-14-tally-gst-input-credit-mismatch.md)**
  Listed P0 in the source discussion; demoted here because the category is
  commercially crowded and a filing draft carries liability a flagged duplicate
  does not.

### P2 — the cold-scan funnel

- **[Is public GitHub the right surface?](2026-09-12-is-public-github-the-right-surface.md)**
  **Answered on yield** — 112 scanned, 27 leads, 19 with criticals. The lane
  works as a lead source. Its untested half is response rate, and its next step
  is the operator sending a message, not code. Closes when one attempt is logged.
- **[Package the Tally wedge as a repeatable install](2026-09-14-package-tally-wedge-as-repeatable-install.md)**
  Deliberately blocked on the first wedge producing a settlement, not a demo.

### P3 — parked, with stated revisit conditions

- **[The four deprioritized recovery wedges](2026-09-14-deprioritized-recovery-wedges.md)**
  Stripe recovery, unused seats, silent renewals, EMI overcharge. All buildable,
  all blocked on credibility with strangers.
- **[Wedges needing a licensed human](2026-09-14-wedges-needing-a-licensed-human.md)**
  Healthcare, legal, manufacturing, construction. Killed on fulfilment, not on
  market size.

### Maintenance — label it as such

- **[The deliverable-staging test fails intermittently](2026-09-14-deliverable-staging-test-is-intermittent.md)**
  Fails under the full suite, passes standalone. It guards the function that
  replaced `existsSync`-as-"tests passed", so a random red here is dangerous.
- **[Lead drones have no dedupe](2026-09-12-lead-drones-have-no-dedupe.md)**

## Closed

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
