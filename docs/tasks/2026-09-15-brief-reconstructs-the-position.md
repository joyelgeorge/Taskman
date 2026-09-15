# `npm run brief` — reconstruct the position instead of recalling it

**Priority: P1. Phase 0 of the accumulating-architecture spec. Progress level 4.**
Raised 2026-09-15.

## What

One command a session runs **first**, which reports the verified position:
settlement count and total, open and closed tasks, outreach attempts by lane and
outcome, leads and criticals, scanned repos, active territories, last five
commits, pending migrations.

`scripts/preflight.js` is not this. It validates configuration and stops there —
it says nothing about where the project actually stands.

## The requirement that makes it worth building

Every line is labelled `verified`, `empty`, or **`UNKNOWN — store unreachable`**,
and the command exits non-zero when a store it needed could not be reached.

Without that label it is just another dashboard, and this project already
learned what an unlabelled dashboard number is worth. **A brief that prints a
zero it cannot stand behind is worse than no brief**, because it will be trusted.

Depends on [empty-is-not-unknown](2026-09-15-empty-is-not-unknown.md) — the
ledger cannot currently supply the distinction this command must print.

## Done looks like

`npm run brief` run with `DATABASE_URL` unset prints `UNKNOWN` for every
Postgres-backed row and exits non-zero. Run with it set, it prints the real
numbers and exits zero. A session that runs it knows what it may and may not
claim.

Full design: `docs/superpowers/specs/2026-09-15-accumulating-architecture-design.md`
