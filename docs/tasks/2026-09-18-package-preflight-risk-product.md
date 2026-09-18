---
status: blocked
priority: P2
level: 1
opened: 2026-09-18
---

# Package pre-flight risk check — CLI + API product

Raised from a `/revenue-discovery` pass, 2026-09-18. Scored **0.69**. Blocked
on [2026-09-18-npm-postinstall-supply-chain-detector.md](2026-09-18-npm-postinstall-supply-chain-detector.md)
— the detector this product wraps doesn't exist yet.

## The idea

`npx preflight <package>` — scans a package's `postinstall`/`preinstall`
scripts (and, once built, other supply-chain heuristics) before a developer
runs `npm install`. Free CLI; paid ($9/mo anchor) API for CI integration.
Precedent this isn't inventing a market from nothing: Socket Security is a
funded company doing this at enterprise scale — the gap is a cheap, indie-
priced alternative, not an unproven category.

`distribution: findable` (optimistic — assumes organic discovery via npm/GitHub
search once published; not `buyers_already_searching` because there's no
existing marketplace funneling buyers to it the way GitHub Marketplace does
for [the CI Action idea](2026-09-18-github-marketplace-ci-action.md), which is
why that one is P1 and this is P2 despite a similar underlying capability).

## Cheapest test, before building the CLI wrapper

Per the `/revenue-discovery` output that raised this: manually run the
detector logic (once built) against ~20 recently-installed packages, post the
worst real finding (anonymized) to r/node or Hacker News asking whether people
would pay for a pre-install check. Reply volume is the signal. Zero code
beyond the detector itself.

## Done looks like

Detector built (see blocking task), CLI wrapper exists, the Reddit/HN
demand-check run and its result recorded — whichever way it comes out.
