---
status: open
priority: P1
level: 4
opened: 2026-09-18
---

# `income_streams` has drifted from `packages/core/territory/registry.js`

Raised from a `/revenue-hunt` pass, 2026-09-18, which queried
`incomeReport()`/`listStreams()`/`getBountyYieldReport()` directly rather than
trusting the revenue-hunt skill's own description of live state (which turned
out to be stale — see below). `registry.js` documents itself as "the single
memory of every lane" and "this project's memory... written from what this
project learned the hard way." `income_streams` is a second, independent
record of overlapping lanes, and the two have not been kept in sync.

## Three concrete drifts found

1. **Three unevidenced streams marked `TESTING`, `origin: 'discovered'`, not in
   git history at all** (`git log -S` across all history returns nothing for
   any of their stream keys, and no file references them):
   `decentralized-gpu-inference`, `defi-flashloan-arbitrage`,
   `depin-bandwidth-sharing`. Each has an empty `evidence: []` and
   `stateReason: null` — `origin: 'discovered'` is documented in this same
   file as "proposed by a detector from recorded evidence," and there is no
   recorded evidence. `defi-flashloan-arbitrage` in particular looks like the
   already-`KILLED` `defi-arbitrage` registry entry ("loses money on failed
   attempts; spread is taken by colocated searchers") revived under a new
   name — a flashloan removes capital risk on a failed attempt but not the
   MEV/colocation competition that was the actual kill reason, so the
   underlying verdict likely still holds. The other two require
   hardware/residential-bandwidth infrastructure that appears nowhere else in
   this codebase. **Do not build against these without first re-deriving
   where they came from** — inserted via `POST /api/money/opportunities`, by
   a stray agent run, or something else worth knowing before trusting the
   label.

2. **`github-paid-bounties` (streams.js) says `BLOCKED`; `registry.js` says
   `KILLED`; `incomeReport()`'s own live output agrees with the kill**
   ("rejected: platform terms prohibit robotic access... platform terms
   prohibit automated participation"). `/revenue-hunt`'s own skill file
   describes this as an active "Lane B" to pursue — it is not; three
   independent sources in this repository (registry, the income report
   function, and the reason originally recorded) all say it terminates on
   Algora's terms of service, not on missing KYC. The skill file needs
   correcting or it will send a future session down this path again.

3. **`payout-audit-direct`'s `nextAction` is already done, just differently**:
   it says "Create the Stripe account, make a payment link, set OFFER.contact
   ... in packages/web/public/audit/index.html" — but `OFFER.contact` is
   already set, to `https://paypal.me/joyelgt`, using the **contingency**
   model (`OFFER.contingencyPercent`), not the flat-fee Stripe link this
   stream describes. `CLAUDE.md` explicitly documents this as a deliberate
   choice ("Payment: contingency, not a flat fee... the /20USD suffix is a
   leftover from the flat-fee model and should not be used for a contingency
   invoice") — meaning this stream's proposed next action would revert a
   pivot that was made on purpose, if followed literally.

## Why P1

Not because it's close to a settlement — because a stale "TESTING" or
"BLOCKED" label in a system whose whole design point is "disprovable instead
of a wish" (this file's own docstring) is actively misleading, and this
skill's own instruction ("focus 100% of effort on lanes marked TESTING or
EARNING") would have sent real effort at flashloan arbitrage on the strength
of a label with no evidence behind it.

## Done looks like

- The three unevidenced streams either get real evidence attached, get
  reset to `HYPOTHESIS` pending that evidence, or get `setStreamState(...,
  'DISPROVEN', {reason: '...'})` if the flashloan one is confirmed to be
  `defi-arbitrage` again.
- `github-paid-bounties` moved to `DISPROVEN` with the same reason
  `registry.js` already records, so `incomeReport()` and `registry.js` agree.
- `payout-audit-direct`'s `nextAction`/`mechanism` updated to describe the
  contingency model actually live today, or the stream is retired in favor of
  whatever the correct current record of that lane is.
- `.claude/skills/revenue-hunt/SKILL.md`'s Lane B section corrected or removed.
