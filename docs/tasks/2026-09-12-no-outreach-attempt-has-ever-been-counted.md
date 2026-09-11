# Nothing counts outreach attempts, so no lane can ever be honestly killed

**Priority: HIGH.** Found 2026-09-12.

`src/commercial-wedge.js` defines a kill criterion for the wedge: trailing-30-day
ROI below 1.5x **after 50 attempts** with zero conversions. `rail-governor.js` now
derives a statistically principled attempt threshold. `packages/core/income/venues.js`
tracks reachability. The machinery for deciding a lane is dead is thorough.

**No outreach attempt has ever been recorded, because nothing records one.**

`leads` has a `status` column (`NEW`/`QUALIFIED`/`REJECTED`/`CONVERTED`) and
`updateLeadStatus` to move it, but there is no record of a *message sent* — no
date, no channel, no response. `acquisition-funnel.js` names the stages
(PROSPECT_SOURCED → CONTACTED → …) and nothing writes to them.

## Why it matters

Every lane is currently unfalsifiable. With zero attempts recorded:

- The audit lane cannot reach its own 50-attempt kill criterion, so it can never
  be honestly retired — it will sit at TESTING indefinitely.
- Nor can it be proven: "we tried and it did not work" is indistinguishable from
  "nobody tried", which is the exact ambiguity that let this project spend a year
  building supply.
- `docs/outreach/audit-lane-first-client.md` ends by instructing the operator to
  record the disproof. There is nowhere to record it.

## Done looks like

The smallest honest thing: a way to record *an attempt was made* — lead id or
prospect, channel, date, and later the response. It can be a table, or a column
on `leads`, or an append-only file; the mechanism matters less than the count
existing.

Then the kill criteria already written can actually fire, and "this lane does not
work" becomes a measurement rather than a feeling.
