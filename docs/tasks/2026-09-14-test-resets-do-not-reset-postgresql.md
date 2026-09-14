# Four test resets clear memory and leave PostgreSQL untouched

Found 2026-09-14 while verifying the ledger guard fix against both storage
modes. Not fixed there because it is unrelated to that change — it is older, and
it is load-bearing for a different lane.

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

Four modules have the same defect. Each exports a `*ForTesting` reset, each is
storage-aware (`databaseEnabled`), and none of them truncates:

- `src/outreach-log.js`
- `packages/core/targets/scan-memory.js`
- `src/durable-scheduler.js`
- `src/metering.js`

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

## The fix

1. Make each of the four resets truncate its table when `databaseEnabled`,
   following `money-ledger.js:692`. They become `async`, so their callers need
   `await` — `test/outreach-log.test.js:15` wraps one already.
2. Re-run each affected suite against PostgreSQL and confirm it matches its
   memory-mode result.

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
