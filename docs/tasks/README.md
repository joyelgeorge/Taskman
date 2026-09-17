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
- **[Neither lead engine can run in a web session](2026-09-17-lead-engine-cannot-run-in-a-web-session.md)**
  Measured by trying: `gh` is absent and repo scoping refuses third-party clones,
  so the cold drone has no input; Reddit and Stack Overflow refuse the crawler, so
  the warm engine cannot see the warmest intent. **Building more of either from a
  web session cannot be tested from a web session.**
- **[The star filter selects against businesses](2026-09-12-star-filter-selects-against-businesses.md)**
  Measured: the search sees 25 of 1,034 repos. Stars proxy for OSS popularity,
  not commerce, so the filter and the business qualifier fight each other.

### High

- **[No outreach attempt is ever counted](2026-09-12-no-outreach-attempt-has-ever-been-counted.md)**
  Kill criteria exist and can never fire, so no lane can be honestly proven or
  retired.
- **[Test resets clear memory and leave PostgreSQL untouched](2026-09-14-test-resets-do-not-reset-postgresql.md)**
  *Fixed 2026-09-14.* Four modules' test resets never cleared their tables, so the
  kill-criterion guard deciding whether a lane lives or dies was verified only in
  the mode where nothing persists. Also records that the four "permanent" failures
  in both modes were **the wrong Node version, not a bug** — the suite is green on
  the pinned runtime. **Run `nvm use` before trusting a test result here.**
  The suite now passes fully: 816/0 memory, 831/0 PostgreSQL.
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
