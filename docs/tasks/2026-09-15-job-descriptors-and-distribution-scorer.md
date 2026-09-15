---
status: open
priority: P2
level: 4
opened: 2026-09-15
---

# Job descriptors, and a scorer that encodes the ranking principle

**Priority: P2. Phase 2 of the accumulating-architecture spec. Progress level 4.**
Raised 2026-09-15.

## What

**Descriptors.** `EXPLORED_TERRITORIES` entries grow from `{key, verdict, note}`
into full revenue-job descriptors carrying `{distribution, economics, rail,
stages}`. One list, merged rather than parallel — this codebase already has four
overlapping concepts for the same idea (territories, rails, stream keys,
fulfilment modules) and does not need a fifth.

Stages are `connect, listen, detect, intervene, verify, measure, charge`.
**Absence is meaningful and enforced**: a job with no `verify` can never reach
`charge`.

**Scorer.** `packages/core/territory/scoring.js` currently encodes the *old*
ranking method, so every future discovery run will keep producing old-order
answers:

```js
distribution: { weight: 0.15, values: {
  buyers_already_searching: 1, findable: 0.6, must_create_demand: 0.2 } }
```

Distribution is weighted lowest of five dimensions, and there is **no value for
"a relationship already exists"** — the warmest case on the board, and the entire
reason the Tally wedge is P0, cannot be expressed. The scorer would rank it below
a cold marketplace lane.

Rewritten: `distribution` to weight 0.35, gains `relationship_exists: 1`, and
`must_create_demand` caps the composite rather than merely lowering it, so cold
lanes cannot rank top without being killed outright.

## Why it matters

`docs/READ-FIRST.md` now says to rank lanes by distribution difficulty. A
principle that lives only in a document is one a future session can miss. This
puts it where it gets applied.

Blast radius is small: `scoring.js` is consumed only by the `territory-scout`
skill and `test/territory-scout.test.js`.

## Done looks like

The scorer ranks `tally-smb-leakage-audit` above a cold lane, and the ordering is
asserted by a test rather than inspected by eye.
