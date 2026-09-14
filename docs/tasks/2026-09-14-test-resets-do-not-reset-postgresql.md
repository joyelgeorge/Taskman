# Test resets clear memory and leave PostgreSQL untouched

Found 2026-09-14 while verifying the ledger guard fix against both storage
modes. Kept as the record of what was wrong and how it was measured.

> **Fixed 2026-09-14.** All three resets now truncate their tables, and
> `test/testing-resets-clear-durable-storage.test.js` guards the property
> directly: write a row, reset, assert it is gone. That test was confirmed red
> against the old code in PostgreSQL before the fix, and — the point of the whole
> entry — **green against the old code in memory mode**, exactly as the rest of
> the suite was.
>
> Two further defects surfaced while fixing it, both recorded below: `respondedAt`
> crossed the storage boundary as a `Date` in PostgreSQL and a string in memory,
> and the now-async resets were being called without `await` at 24 sites.

## What is wrong

`resetOutreachLogForTesting()` is this, in full (`src/outreach-log.js:158`):

```js
export function resetOutreachLogForTesting() {
  mem.attempts.length = 0;
}
```

It clears the in-memory array and never touches the `outreach_attempts` table.
In PostgreSQL mode the reset is a **no-op that reports success**, so rows
accumulate across every test in the file. `money-ledger.js:692` shows the
correct shape for comparison — `await truncateForTesting([...])`.

Three modules had the same defect. Each exports a `*ForTesting` reset, each is
storage-aware (`databaseEnabled`), and none of them cleared its tables:

- `src/outreach-log.js`
- `packages/core/targets/scan-memory.js`
- `src/metering.js`

> **Correction.** An earlier version of this file also listed
> `src/durable-scheduler.js`. That was wrong: it already clears both its tables
> with plain `DELETE FROM`. It was caught by a grep for `truncateForTesting`,
> which is a search for one spelling of the fix rather than for the property —
> the same mistake, in miniature, as the bug being described here.

## Measured

Same file, same commit, the only difference being the storage mode:

| | memory | PostgreSQL |
|---|---|---|
| `test/outreach-log.test.js` | **13 pass, 0 fail** | **5 pass, 8 fail** |

Run alone, against a freshly created and migrated database, so this is not
cross-file interference. A representative failure is `summary counts what the
kill criteria need`: `expected: 5, actual: 67` — the count from every prior test
in the file, still in the table.

This accounts for 9 of the 14 failures in a full PostgreSQL run (8 in
outreach-log, 1 in scan-memory). Of the remaining 5, four fail in **both** modes
(the shutdown/signal tests and `status contract exposes safe runtime
compatibility metadata`) and are a separate, older problem.

## Why this one is not cosmetic

`outreach-log` is the module that exists to answer the question in
`2026-09-12-no-outreach-attempt-has-ever-been-counted.md` — the High-priority
task noting that kill criteria can never fire, so no lane can be honestly proven
or retired. Its kill-criterion tests (`the kill criterion fires at 50 attempts
with zero paid`, `one paid customer keeps the lane alive at any attempt count`)
are **green in memory and broken in PostgreSQL**, which is the mode production
runs in.

So the guard that decides whether a revenue lane lives or dies is currently
verified only in the mode where nothing persists.

It is also the same defect shape as the ledger bug fixed in `e9e3d9a`: a thing
named for the property it is supposed to establish, which actually observes
something weaker. `resetOutreachLogForTesting` sounds like it resets the
outreach log. It resets an array.

## What the fix turned up

Truncating was the easy part. Two further defects only appeared once the resets
started working, and both are worth knowing because neither was visible before:

1. **`respondedAt` had the same dual-storage bug as the ledger's `verifiedAt`.**
   `timestamptz` comes back as a `Date` from PostgreSQL and as the ISO string it
   was given from memory, so `normalize()` in `src/outreach-log.js` emitted
   different types per mode. One test compared the value and failed on the type.
   Fixed by normalizing to ISO in `normalize()`, as `money-ledger.js` now does.
2. **The resets became `async`, and 24 call sites were not awaiting them.**
   `test/outreach-log.test.js` alone had 13. One was a sync `beforeEach` in
   `test/metering.test.js`, which turned into a syntax error rather than a silent
   race — lucky, because the silent version is the one the `verifying-guard-tests`
   skill warns about: a fixture cleared mid-test makes tests pass for the wrong
   reason.

Note also that `test/metering.test.js` is memory-only — its `beforeEach` returns
early when `databaseEnabled` and its cases are marked `memoryOnly` — so the
truncation added to `resetMeteringForTesting` is defensive rather than
load-bearing today.

## Result

`test/outreach-log.test.js` and `test/scan-memory.test.js` now match across
modes. Affected suites: **24 pass / 0 fail** against PostgreSQL run serially,
**30 pass / 0 fail** in memory (the difference is the memory-only metering
cases).

## Testing it properly

Per `verifying-guard-tests`: a reset that cannot be shown to reset is exactly
the class of thing this repository keeps getting caught by, so do not trust the
suite going green as evidence. Write one test that **writes a row, calls the
reset, and asserts the row is gone**, and confirm it fails against today's code
before fixing it.

Note the trap that hid this for so long: run the suite in memory mode and
everything passes. The bug is only visible with `DATABASE_URL` set.

## Also worth knowing

Files run in parallel against a single database by default, which produces a
second, independent source of phantom failures. `--test-concurrency=1` is
therefore load-bearing rather than a performance note, and
`docs/READ-FIRST.md`'s PostgreSQL invocation already includes it. Two failures
were chased down this session that were only races; one measurement was taken
against a database that had stopped, and reported 12 failures that were entirely
`ECONNREFUSED`. Check `pg_isready` before believing a PostgreSQL run.
