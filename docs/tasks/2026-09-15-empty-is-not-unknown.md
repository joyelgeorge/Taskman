# `listSettlements` cannot tell "no money" from "no database"

**Priority: P1 — a live correctness bug, and the smallest one here.**
Found 2026-09-15 while designing the accumulating architecture.

## What

`src/money-ledger.js:299`

```js
export async function listSettlements({ rail = null, limit = 200 } = {}) {
  if (!databaseEnabled) {
    return memory.settlements...      // empty array on a fresh boot
  }
```

A session without `DATABASE_URL` asks how much money has been made and receives
`[]` — byte-identical to the answer from a reachable database with zero rows.

## Why it matters now rather than later

It is harmless **today only because the true answer is zero either way.** The day
the first settlement clears, a local session reports $0, states it with
confidence, and every claim built on it inherits the error.

This is the whole hallucination problem in one boolean. The repository's stated
discipline is "the source of truth is the database" — but the database and its
absence currently return the same value, so the discipline cannot be followed
even by someone trying to follow it.

Memory mode is a legitimate mode and must keep working (`CLAUDE.md` rule 4). The
bug is not that memory mode returns an empty list. It is that **the caller cannot
tell which mode answered.**

## Done looks like

Reads that can be affected by store availability return, or carry, a state of
`verified` / `empty` / `unknown`, and no caller can render a zero from an
unreachable store. Then `npm run brief` (see the spec) can report a position a
session is allowed to trust.

Full design: `docs/superpowers/specs/2026-09-15-accumulating-architecture-design.md`
— this is Phase 0, and it is worth more than phases 2–5 combined.

**Guard test must be broken to count** (`.claude/skills/verifying-guard-tests/`):
a test that passes when the distinction is removed is not a test of it.
