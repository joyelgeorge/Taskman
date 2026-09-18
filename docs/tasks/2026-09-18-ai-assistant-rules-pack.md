---
status: blocked
priority: P3
level: 1
opened: 2026-09-18
---

# Vulnerability-class rules pack for AI coding assistants

Raised from a `/revenue-discovery` pass, 2026-09-18. Scored **0.50, capped**
— `distribution: must_create_demand`, because no marketplace with native
paid billing for Cursor rules or Claude skills was confirmed to exist at time
of writing (unlike GitHub Marketplace, which is why
[the CI Action idea](2026-09-18-github-marketplace-ci-action.md) outranks
this one on the same underlying knowledge base). Marked `blocked` rather than
`open`: re-check whether such a marketplace exists before starting, since that
single fact changes the distribution label and the priority.

## The idea

Package the vulnerability classes this project has already catalogued
(missing RLS, exposed service_role, open CORS, unauthenticated admin routes,
plus whatever the three detector tasks opened today add) as a rules file that
makes Cursor/Claude Code/Copilot avoid generating the bug in the first place —
prevention sold to the same buyer currently only reachable after the fact via
a scan.

## Why P3, not higher

Same underlying content as the starter template and the CI Action, weaker
distribution than either, and closer to a lead magnet (free, drives traffic
to the scan/fix funnel) than a priced product until a real paid channel for
it is confirmed to exist.

## Done looks like

Either: a paid-rules marketplace is confirmed to exist and this gets
re-scored and reopened with a real distribution label; or it ships free as a
GEO/content asset (Sellman's `content-strategist` territory, not this
repository's) and this task closes as superseded.
