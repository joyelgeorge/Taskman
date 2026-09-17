---
status: open
priority: P1
level: 1
opened: 2026-09-17
---

# Lane: sell the detector as an agent, where distribution is provided

Researched 2026-09-17. **The first lane on this board where the distribution
problem is solved by someone else**, which is the constraint every previous lane
died on.

## What the market says

- AI agents hit **$7.6B in 2025, projected $47B by 2030**; 2026 is named as the
  year the category became real revenue.
- Marketplace splits run **70–85% to the creator**.
- A productised agent earns **$20–100/month per user**; a custom agent solving a
  high-value business problem commands four to low-five-figure monthly retainers.
- The most profitable niches named for 2026 are **"boring" B2B operational
  ones** — and the list includes, verbatim, **"financial reconciliation bots for
  small businesses."**

## Why that last line matters here

`packages/core/tally/duplicate-invoice.js` **is a financial reconciliation bot
for small businesses.** Built, mutation-tested, DETECT-only, and it runs on a
plain tabular export any accounting package can produce.

It is currently P2 and blocked, because its premise was that the operator had a
trusted relationship with one retailer — and the answer on 2026-09-17 was
**"access yes, relationship no."** The detector was never the problem. The
distribution was.

**A marketplace supplies exactly the missing half.** No cold outreach, no
relationship to originate, no stranger asked to hand over their books — the
buyer arrives having already decided they want a reconciliation agent.

## Why this is level 1 and not level 4

It targets a settlement row directly, and every part except the listing exists.
That is unusual on this board and is the reason it is P1 despite being new.

## What must be verified before building anything

Gate 1 first, as always: **which marketplace can pay an Indian individual?**
Splits and volumes are worthless if the rail fails, and this project has already
lost a lane (Algora) to exactly that. Answer that before writing a listing.

Then: does the marketplace's terms permit an agent that reads a customer's
financial export? Data-handling terms are the second gate here, not an
afterthought.

## Done looks like

One listing live on one marketplace whose payment rail has been confirmed to
reach the operator — or a recorded kill naming the rail that failed.

## Do not

Build a second detector for this. The Tally one is built. The work is listing,
pricing and rails — none of which is code.
