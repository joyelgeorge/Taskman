---
status: open
priority: P1
level: 1
opened: 2026-09-18
---

# GitHub Marketplace CI Action — continuous scan instead of one-off audit

Raised from a `/revenue-discovery` pass, 2026-09-18. Scored against
`packages/core/territory/scoring.js`: **0.75** — the highest of five new
distribution candidates opened today (package-preflight product 0.69,
secure-by-default starter 0.65, cyber-insurance referral 0.73, AI-assistant
rules pack 0.50 capped). Full scores in the brainstorm transcript that opened
this file; not re-derived here.

## The idea

Package the existing `src/codebase-audit.js` detector set as a GitHub Action
that runs on every PR, listed on GitHub Marketplace. `distribution:
buyers_already_searching` — GitHub Marketplace is a standing,
billing-integrated marketplace, the one dimension weighted 0.35 that has
capped or killed nearly everything else in this project's history
(`packages/core/territory/scoring.js`'s own comment on why `distribution`
replaced two earlier, unsuccessful ranking methods).

This is the existing vibe-app-security wedge pointed at a different buyer: not
"here's what's wrong with your app today" (a one-time audit, cold outreach
required) but "keep this from shipping again" (continuous, self-serve
install, no outreach — the buyer finds the listing).

## Why P1

Highest distribution score of the new batch, and the detector logic it
packages already exists — this is integration and a Marketplace listing, not
new detection capability. Not P0: it doesn't have the Tally wedge's
`relationship_exists` warmth, and GitHub Marketplace's app-review process is
an unknown timeline, not a switch to flip.

## What's needed

1. Wrap `auditCodebase` (or the subset of `find*` functions worth running per
   PR — probably all of them, cost is cheap for static analysis) as a GitHub
   Action (`action.yml` + a thin Node entrypoint that posts findings as a PR
   check/comment).
2. Free tier (public repos) to seed reviews and visibility; paid tier
   (private repos, `$15/mo` anchor from the `/revenue-discovery` pass) billed
   through GitHub Marketplace's native billing — no separate Stripe/PayPal
   integration needed for this channel specifically.
3. Marketplace listing copy, screenshots — the "marketplace screenshots need
   a human" gap already named in the Sellman handoff applies here too.
4. Submit for GitHub App/Action review; timeline unknown until tried.

## Done looks like

Listed and installable from GitHub Marketplace, at least one real install on a
repo the operator doesn't own, one real PR check run producing a finding.
