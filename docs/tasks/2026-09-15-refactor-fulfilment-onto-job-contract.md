# Refactor the two fulfilment modules onto the job contract

**Priority: P3 — deliberately last. Phase 4 of the accumulating-architecture
spec. Progress level 4.** Raised 2026-09-15.

## What

`src/audit-fulfilment.js` and `src/scan-fulfilment.js` become descriptor
implementations rather than hand-written modules. They are the two real cases
that prove the contract fits something that already exists, instead of something
imagined.

## Why it is sequenced last, and why that is not caution for its own sake

These two modules are **the only finished settlement paths in the repository.**
`docs/READ-FIRST.md` records that six code paths can record a settlement and
none has ever been travelled; these two are the closest to being travelled, and
`payout-audit-direct` is one human action from live.

Refactoring an untravelled path onto a new contract can break it in a way no
test catches, because no test can cover the part that has never run in
production. The failure would surface at the worst possible moment — the first
time a real customer pays.

## Rules for doing it

- Only after the runner's gates are proven by mutation tests.
- Behaviour must be unchanged. Not "equivalent" — unchanged.
- **If it fights, stop and leave them alone.** The contract is worth less than
  the two paths. A third job can be written against the runner directly without
  touching these at all.

## Done looks like

Both modules run through the runner, the full suite passes, and the diff shows
no behavioural change — or this task is closed as "not worth it" with the reason
recorded, which is also a valid outcome.
