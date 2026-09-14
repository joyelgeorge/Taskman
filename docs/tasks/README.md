# Parked tasks

Work that was found but deliberately not done, so it can be picked up later
instead of blocking whoever found it.

## Open, by priority

Priority is against one question: **which settlement row does this produce, and
who pays it?** (see `docs/READ-FIRST.md`).

### Critical — may invalidate or unblock a whole lane

- **[The ledger guard tests presence, not verifiability](2026-09-13-ledger-guard-tests-presence-not-verifiability.md)**
  *Partly fixed 2026-09-14* — clearing a settlement now requires naming an outside
  observation, so the fabricated $220 is refused. Still open: **nothing reconciles
  recorded rows back against the provider**, which is the only check that leaves
  the process. The claim that this repo's $0 is real rests on this guard.
- **[Is public GitHub the right surface?](2026-09-12-is-public-github-the-right-surface.md)**
  The scan lane assumes vibe-coded businesses publish their source. Untested, and
  probably mostly false. **Measure before investing further in scanning.**
- **[The primary lead engine is not running](2026-09-12-primary-lead-engine-is-not-running.md)**
  The repo calls `warm-lead-scout` the primary engine. It has no cron, no script
  and no persistence. All the engineering went to the funnel labelled low-yield.
- **[The star filter selects against businesses](2026-09-12-star-filter-selects-against-businesses.md)**
  Measured: the search sees 25 of 1,034 repos. Stars proxy for OSS popularity,
  not commerce, so the filter and the business qualifier fight each other.

### High

- **[No outreach attempt is ever counted](2026-09-12-no-outreach-attempt-has-ever-been-counted.md)**
  Kill criteria exist and can never fire, so no lane can be honestly proven or
  retired.
- **[Test resets clear memory and leave PostgreSQL untouched](2026-09-14-test-resets-do-not-reset-postgresql.md)**
  *Fixed 2026-09-14.* `test/outreach-log.test.js` was 13/13 green in memory and 8
  failures against PostgreSQL because its reset only emptied an array — so the
  kill-criterion guard deciding whether a lane lives or dies was verified only in
  the mode where nothing persists. Kept for the measurement and for the two
  further defects the fix exposed.
- **[One search query returns zero](2026-09-12-one-search-query-returns-zero.md)**
  Minutes to fix; contributing nothing to every run.
- **[Verify the CI database is migrated](2026-09-11-verify-ci-database-is-migrated.md)**
  Needs a manual workflow run. Blocks the first real sweep.

### Medium

- **[Candidate cap is 75 against a 1,000 pool](2026-09-12-candidate-cap-is-75-against-a-1000-pool.md)**
- **[Lead drones have no dedupe](2026-09-12-lead-drones-have-no-dedupe.md)**

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
