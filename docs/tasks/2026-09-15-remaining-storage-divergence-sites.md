---
status: open
priority: P3
level: 4
opened: 2026-09-15
---

# Ten more reads still cannot say "I could not answer"

**Priority: P3 — honest remainder of Phase 0.** Raised 2026-09-15.

## What Phase 0 actually fixed

`settlementPosition()` in `src/money-ledger.js`, plus the `verified / empty /
unknown` vocabulary in `src/store-state.js`, plus `npm run brief`, which reads
the other stores directly and carries their state.

**The revenue claim path is closed.** That was the one that mattered: it is the
number a session is most likely to state as fact.

## What it did not fix

Run the repository's own detector against its own ledger:

```
node -e "...findStorageDivergence('src/money-ledger.js', text)"  ->  11 findings
```

Eleven `if (!databaseEnabled)` branches; Phase 0 addressed one. The remaining ten
— and the same pattern elsewhere in `src/` — still return memory-mode data that a
caller cannot distinguish from a verified answer.

Worth noting plainly: **we ship a scanner that flags this pattern in other
people's code.** `findStorageDivergence` exists in `src/codebase-audit.js` and is
part of what the vibe-app sweep sells. Our own ledger has eleven.

## Why the rest was not done now

Converting every read would touch most callers in the repository and change the
shape of returns the 840-test suite asserts against, for reads whose answers are
not currently quoted as fact. The cost is real and the risk is not.

The honest position is that the vocabulary now exists and the dangerous read uses
it. The rest is a migration, and it should happen when a read starts being
reported rather than pre-emptively.

## Done looks like

Each remaining read either carries a state or is documented as memory-mode-only
and never reported. The detector's finding count for `src/` is a number we chose
rather than one we inherited.
