# Verify the CI DATABASE_URL points at a migrated database

**Found:** 2026-09-11, while adding lead persistence to the vibe-app sweep.

## What

`cron-vibe-lead-sweep.yml` now writes leads to Postgres and runs
`npm run migrate` first. The `DATABASE_URL` secret exists on the repo (set
2026-09-05) and twelve other workflows use it, so it is almost certainly live.

But nobody has confirmed that the database it points at is reachable from CI
*and* that migrations apply cleanly there — in particular `033_scanned_repos`,
which is new.

## Why it was not done now

Checking requires the connection string, which is a repo secret. It cannot be
read or tested from a local session.

## Why it matters

Monday's sweep is the first run that depends on it. If the database is
unreachable or the migration fails, the sweep fails loudly (by design) rather
than silently — so this is a delay, not a data-loss risk. But it wastes the
week.

## Done looks like

Trigger the workflow manually (`workflow_dispatch` is enabled) and confirm the
"Apply pending migrations" step succeeds and the sweep reports a non-zero
`persisted:` line, or fails with a message naming the actual cause. Then delete
this file in the same commit.
