---
status: blocked
priority: P3
level: 1
opened: 2026-09-14
---

# Package the Tally wedge as a repeatable install

**Priority: P2 — blocked, deliberately.** Raised 2026-09-14
(`taskman-repo-tasks.pdf`, Task 3).

## Scope

Offer the same detector and pricing to two or three more small retailers **from
the operator's existing network** — not cold outreach — using the first
retailer's result as the proof.

## Why it is blocked and should stay blocked

It is gated on
[the duplicate-invoice detector](2026-09-14-tally-duplicate-invoice-detector.md)
producing a real payment. Not a working detector, not a happy retailer — a
settlement row.

This gate is the whole lesson of `docs/WHY-NO-MONEY-YET.md`. Packaging is how
this project has failed before: build the general case from an instance that
never actually closed, and the generalisation inherits the flaw invisibly. The
second customer is worth having *because the first one paid*, which is evidence
about the offer. Without that it is just the same unproven thing, three times.

## The one thing worth doing now

Nothing in code. But when the first retailer is being worked, **write down what
actually happened** — what the report looked like, what they said, what they
questioned, how long recovery took, what they paid and how. That record is the
entire input to this task, it cannot be reconstructed later, and it is the
credibility bridge Task 4 depends on.

## Done looks like

A second and third settlement row from named businesses in the operator's
network, plus a written statement of what the offer is that was refined by
contact with a real customer.
