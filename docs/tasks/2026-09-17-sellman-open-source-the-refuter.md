---
status: open
priority: P1
level: 3
opened: 2026-09-17
---

# Sellman: publish the refuter as a standalone package

**Free distribution built from the one thing no competitor has.**

`packages/core/findings/reachability.js` (built 2026-09-17) decides whether an
injection finding is reachable by untrusted input, using two independent signals
that are never averaged into a score. Thirteen named competitors ship detection.
**None of them ships refutation**, because refutation makes your own numbers
smaller and nobody markets a tool that reduces its own finding count.

That is exactly why publishing it works as marketing.

## The mechanic

A developer drowning in scanner noise installs a small package that tells them
which of their command-injection alerts are in build scripts touching
`process.env`. It costs them nothing, it makes their report shorter, and the
README is the teardown's argument in executable form.

Every install is a distribution touchpoint that required no outreach, and the
package is a **credential**: proof the accuracy claim is code, not copy.

## Why it does not give away the business

The refuter is the cheap half. The product is the **fix plus proof it landed**
(`proveFixed`, the agency offer's deliverable), which needs the operator. Giving
away the part that makes reports *more honest* is the strongest possible
advertisement for the part that makes them *actionable*.

## Scope

Small on purpose. The module, its tests, a README that states the flyrpro
measurement, and the guard-test discipline that verified it. No new code.

## Done looks like

Published, and one inbound — an issue, a star, a mention — that did not come
from someone the operator contacted.

## Honest risk

Unvalidated that anyone installs it. Publishing costs an afternoon and fails to
silence, which is the right shape for a free-channel bet, but it is a bet.
