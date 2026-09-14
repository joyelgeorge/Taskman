# Parked tasks

Work that was found but deliberately not done, so it can be picked up later
instead of blocking whoever found it.

## Open, by priority

Priority is against one question: **which settlement row does this produce, and
who pays it?** (see `docs/READ-FIRST.md`).

### Critical — may invalidate or unblock a whole lane

- **[The primary lead engine is not running](2026-09-12-primary-lead-engine-is-not-running.md)**
  The repo calls `warm-lead-scout` the primary engine. It has no cron, no script
  and no persistence. All the engineering went to the funnel labelled low-yield.
  **Now the highest-value open task**: the cold-scan funnel is fixed and full,
  and the bottleneck has moved from finding leads to contacting them.

### High

- **[Is public GitHub the right surface?](2026-09-12-is-public-github-the-right-surface.md)**
  **Answered on yield** — 112 scanned, 27 leads, 19 with criticals. The lane is
  not dead. Held open only until the first outreach attempt is logged, because
  response rate is the untested half.

### Medium

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
