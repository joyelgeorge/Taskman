---
name: expanding-the-search
description: Use when a lead source is exhausted, when scanning or qualifying is producing thin or false results, when deciding where to look next for targets or revenue, and whenever a single heuristic or query is about to be trusted as the whole answer.
---

# Expanding the search

## Overview

One query, one heuristic, one perspective collapses to median consensus — and
median consensus has a blind spot it cannot see. The fix is not a better single
query. It is **contrasting perspectives, with the disagreements surfaced rather
than averaged away.** The `packages/core/creative/` engine implements this; this
skill is when and how to reach for it.

## The perspectives — run them against each other, not in sequence

Each answers a question the others structurally cannot. Real findings have been
lost to every one of these blind spots.

| Perspective | Asks | The miss it prevents |
|---|---|---|
| **Adversarial** | can untrusted input reach a sink? | — |
| **Defensive** | is there a guard, middleware, auth wrapper? | **6/6 admin routes falsely flagged** — a `requireSuperAdmin()` helper the adversarial view never looked for |
| **Reachability** | is the vulnerable code actually reachable? | flyrpro's "command injection" was in a local script no request touches |
| **Temporal** | is the finding still live, or already decayed? | Supabase auto-revokes leaked keys — a stale finding is an embarrassment |
| **Economic** | real business, or a toy/template? | `thread-and-form-store` was a template; a disclosure there is wasted |

## Disagreement is the signal, not the noise

When two perspectives make opposing claims about one target, that is the most
informative state on the board — and it is exactly where the expensive mistakes
live. **A contested finding is never auto-promoted to outreach.** It goes to a
human, which is the cheapest place to spend one minute of attention. Averaging
the two into a confidence score is how the admin-route bug would have shipped.

## Symbolic pruning beats confidence scores

A deterministic check — an AST walk, a route-graph lint, a `pg_tables` query —
that *refutes* a claim kills it outright, regardless of how confident the
generator was. Facts beat claims. Prefer a symbolic refuter over a threshold
every time one exists.

## Where to expand when a lane is exhausted

The vibe-app repo surface is a depleting stock (measured: 108/120 already
scanned). When a source runs dry, change the **axis**, not the volume:

- **Surface:** deployed bundles, not just repos (~50x hit rate, immune to
  GitHub auto-revocation). See `scan-bundles`.
- **Intent:** warm inbound (people asking for help) over cold outreach. See
  `warm-lead-scout`.
- **Distribution:** self-serve pull (they come to you) over push. See
  `self-serve-revenue-lane`.
- **Vertical:** a different stack with the same class of mistake (Firebase rules,
  exposed Stripe keys, Next.js middleware gaps).

Grinding the same query harder is not expansion. A new axis is.

## When NOT to expand

Expanding the search is a band-3 activity (produces qualified leads). If a
band-1 or band-2 action is available — a staged disclosure to send, a working
product to launch — do that first. More supply while the revenue path waits on a
human step is the trap this project is named after. See `deciding-the-next-step`.

## Common mistakes

| Mistake | Cost |
|---|---|
| One heuristic trusted as the answer | The blind spot ships as a false positive |
| Averaging disagreement into a score | Buries the highest-value signal |
| A confidence threshold where a symbolic check exists | Facts lose to vibes |
| Scaling volume on an exhausted surface | Motion, not expansion |
| Expanding while a dollar waits on a human step | The documented failure mode |
