---
status: open
priority: P0
level: 2
opened: 2026-09-17
---

# Access without distribution: what to do with the Tally data now

Opened 2026-09-17, replacing the P0 that
`2026-09-14-tally-duplicate-invoice-detector.md` lost when its premise was
checked. The operator's answer was **"access yes, relationship no"** — the
retailer's data is genuinely reachable, and that retailer will not act on a
report from us.

## Why this is P0 rather than a kill-note

Every other lane in this repository died at the same place: *a machine cannot
originate a trusted relationship on its own.* This one dies one step later, and
the step it reached is the one nobody has reached before — **there is real,
permitted, live commercial data here.**

That matters because of what the 2026-09-13 research established: where the only
barrier is doing the work, price falls to marginal cost (seven strangers will fix
a Supabase app for $10–40); where the barrier is a right of access, price holds.
Access to a real retailer's books is a rights barrier. It is the single most
defensible asset this project has ever had, and it has been sitting behind a
task that was about to be closed as blocked.

What is missing is not access and not code. It is **one person who will act on
the output.** That is a distribution problem, and it is nameable, which the
previous P0's blocker was not.

## The two routes

### Route A — turn the access into a credential

The detector is built and mutation-tested. Run it on one real export and produce
the first verified finding this project has ever had on **live commercial data**:
*n duplicate invoices, ₹x exposed, on a real retailer's books.*

Anonymised, that is not a lead — it is the proof a stranger needs before handing
over their own books. `READ-FIRST.md` calls a confirmed finding progress level 3;
this is stronger, because it is commercial rather than a public repo, and because
no competitor in the 2026-09-17 price survey has one.

**Cost:** one export, one run. **Honest risk:** a case study is not a customer,
and "build a credential" is exactly the sentence level-4 work uses to sound like
level 2. It earns P0 only as the *input to Route B*, never on its own.

### Route B — sell through someone who already has the trust

Raised in the original ideation handover and never pursued: **chartered
accountants already have both the client relationships and the data access.**
A CA serves many retailers, is already trusted with their books, and already
opens Tally.

This inverts the constraint instead of fighting it. We do not need to originate
trust with a retailer; we need one CA to find the tool useful. And a CA is a
*channel*, not a single customer — which is the difference between this and every
lane that has died so far.

**The first move is one conversation with one accountant**, carrying the Route A
finding. Not a product, not a package, not an install script.

## Done looks like

One of:

- A CA has seen a real finding from their own or an anonymised client's data and
  said whether they would use it — a yes or a no, either of which is progress.
- Or: recorded that no CA is reachable either, at which point the access asset
  has no distribution at all and the wedge is genuinely dead. Write that in the
  registry and stop.

## Do not

- **Do not build the packaging task** (`2026-09-14-package-tally-wedge-as-repeatable-install.md`).
  It is stacked on the premise that just failed, and a repeatable install for a
  wedge with no buyer is the exact shape of the 184 staged deliverables.
- **Do not widen the detector.** It already finds three things on a plain export.
  Nothing about the blocker is a missing feature.
