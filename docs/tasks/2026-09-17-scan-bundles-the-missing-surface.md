---
status: open
priority: P2
level: 3
opened: 2026-09-17
---

# scan-bundles: the highest-value surface is a dangling reference

`expanding-the-search` names four axes to expand along when a lane is exhausted,
and the first carries the strongest claim on the list:

> **Surface:** deployed bundles, not just repos (~50x hit rate, immune to GitHub
> auto-revocation). See `scan-bundles`.

**`scan-bundles` does not exist.** Verified 2026-09-17: the skill directory is
absent. The best axis in the repo's own expansion guide points at nothing.

## Why it is worth more than the ~50x

Three things at once, and the second two are not in the claim:

- **It answers R1 for free.** A deployed site with a working storefront *is* the
  business-qualification signal. The cold repo funnel wastes findings on
  templates (`thread-and-form-store`); a bundle cannot be a template that nobody
  runs.
- **It reflects what actually shipped**, not what is in a repo — and most
  vibe-coded businesses never make the repo public at all, which is the open
  question in `is-public-github-the-right-surface`.
- **Bundles are fetched, not cloned.** The 2026-09-17 session could not clone a
  third-party repo (scoping) but a bundle is an ordinary HTTPS GET, so this
  surface sidesteps the block that stopped the cold drone — in a runtime with
  egress.

## What exists to build on

`packages/core/marketing/demand-sources.js` now makes this cheap: a new source
entry declaring `REACH.HTTP`, plus a fetcher. Not a bespoke script, and its yield
is measured per query from day one.

The detectors already run on text. A bundle is text.

## Done looks like

One deployed bundle fetched, scanned, and a finding produced — or a recorded
measurement that the ~50x claim does not survive contact, which is equally
valuable and has never been checked.
