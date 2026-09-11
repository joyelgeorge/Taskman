# Question the premise: are vibe-coded businesses even on public GitHub?

**Priority: CRITICAL — this may invalidate the whole lane.** Raised 2026-09-12.

## The doubt

The scan lane assumes that businesses built on Lovable, Bolt, v0, Cursor and
Replit have their source **public on GitHub**. That assumption has never been
tested, and there is reason to think it is mostly false:

- Those platforms deploy hosted apps. Pushing to a public repository is an extra,
  optional step.
- A founder with paying customers has an active incentive *not* to publish the
  source of their product.
- The repos that *are* public skew to templates, tutorials, portfolio pieces and
  abandoned experiments — which is exactly what the `genuine` qualifier spends
  its time rejecting.

If that is right, the lane's structural ceiling is not the filters. It is that
the population of "vibe-coded app with paying customers AND public source" may be
close to empty, and no amount of query tuning reaches it.

## Why this matters more than the other tasks

`CLAUDE.md` names securing vibe-coded apps as **the validated paying market** —
proven by scanners at $5–29/mo, Fiverr fixes at $80–125, and dedicated shops.
That demand is real. The question is only whether **public repo scanning** is a
way to reach it, or whether it is this project's third attempt at building
supply against a channel nobody validated.

The warm-lead route reaches the same market from the other end: people who are
already asking. See `2026-09-12-primary-lead-engine-is-not-running.md`.

## Done looks like

A measurement, not an argument. From one loosened sweep, record:

- candidates scanned
- how many had a confirmed finding
- how many passed `genuine`
- **how many of those are plausibly a real business with customers** — a custom
  domain, a pricing page, live payment keys

If the last number is zero or one across a few hundred repos, write the lane up
in `packages/core/territory/registry.js` as KILLED with the count, and move the
effort to the warm-inbound engine. If it is meaningfully non-zero, the filters
are the problem and the other tasks are worth doing.

**Do this measurement before investing further in the scanning path.**
