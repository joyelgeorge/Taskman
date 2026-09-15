# Tally duplicate-invoice / shrinkage detector — the first warm-distribution wedge

**Priority: P0.** Raised 2026-09-14, from the operator's wedge-selection
discussion (`taskman-repo-tasks.pdf`, Task 1).

## Why this outranks everything else in this directory

`docs/READ-FIRST.md` names the load-bearing constraint of this whole project:

> a machine cannot originate a trusted relationship on its own

Every lane in the registry is blocked on that, and no lane has ever cleared it.
This wedge is the first proposal where **the constraint is claimed to be already
satisfied**: the operator states they have working access to one real retailer's
Tally data, with no cold outreach required.

If that is true, this is the shortest path to progress level 1 in READ-FIRST
that has ever been on the board — because the part that has killed every
previous lane is already done, and the part that is left is code, which this
project is good at.

## The one claim everything rests on — verify before building

> **HYPOTHESIS:** the operator has live, permitted access to one retailer's Tally
> data, and that retailer would look at a report.

This is not verifiable from the repository. It is one question to the operator,
and it costs nothing to ask before writing a line:

1. Which retailer, and what is the actual access — a shared folder, a machine
   you can sit at, exports someone sends you?
2. Do they know you would be looking at their books, and are they willing to be
   shown a report?
3. Have they ever lost money to a duplicate invoice, or is that our guess?

**If the answer to 2 is no, this is cold outreach with extra steps and the P0
disappears.** The whole advantage is permission that already exists.

## A technical caveat the scope statement hides

The scope says `CONNECT: existing Tally database folder access`. Do not read
that as "parse the folder".

> **REFERENCED, needs a check against the operator's actual install:** Tally
> stores company data in an undocumented proprietary binary format (`*.900`
> files in the company directory). There is no published schema, and parsing it
> is not a supported route.

The supported integrations are the XML-over-HTTP gateway TallyPrime exposes when
configured to act as a server (commonly port 9000), ODBC, and plain
XML/Excel exports. **Establish which of these the retailer's install allows
before designing the ingest**, because "folder access" and "queryable data" are
not the same thing, and finding that out after building the detector is the
expensive order.

## What already exists and should be reused

This is not a new business model. It is `audit-tool-contingency` — the lane the
registry already marks ACTIVE, priced at a contingency percentage of what the
customer confirms they recovered — pointed at a **warm** customer instead of a
stranger. See the `taskman-audit-lane` skill and the deployed tool.

The detector is the only genuinely new part. The report format, the pricing
model, the settlement recording and the human gate all exist.

## Settlement mechanics — decide before the first invoice

`src/money-ledger.js:74` accepts `stripe`, `paypal`, `bank`, `manual_receipt`,
and requires a non-empty `externalRef`. For a small Indian retailer paying a
four-figure rupee amount:

- `paypal.me/joyelgt`, the route `CLAUDE.md` documents, is **wrong for this
  customer**. A neighbourhood retailer pays by UPI or bank transfer.
- The fit is `source: 'manual_receipt'` with `externalRef` set to the UPI or
  bank transaction reference — something that can be re-checked later, which is
  the rule the ledger is actually enforcing.
- `currency` is already parameterised (`money-ledger.js:205`) and defaults to
  USD. Pass `'INR'`. **`gross_cents` is a minor unit**, so ₹500 is `50000`, not
  `500`. Getting this wrong silently reports a 100× error in the first revenue
  this project has ever had.

## Hard constraint on INTERVENE

**Draft only. Never write to the retailer's Tally.** The scope statement already
says this and it matches the invariant the rest of the repo runs on (`CLAUDE.md`
rule 2: the agent prepares, a human decides). A tool that edits a live ledger
needs a trust level that does not exist yet, and one bad write ends the
relationship and the lane together.

## Done looks like

**One `CHARGE` event recorded through `recordSettlement`** — real money, any
size, from the retailer, with a reference someone could check.

Not: a working detector. Not: a flagged report. Those are progress levels 4 and
2. This project has built a finished machine for six settlement paths and
travelled none of them, so the milestone is deliberately the payment.

## Scope discipline

The diagnosed failure of this repository is building the whole supply chain
before testing whether anyone pays (`docs/WHY-NO-MONEY-YET.md`). So:

Build the smallest thing that can find one real duplicate in one real ledger and
put it on one page in front of one retailer. A scheduled ingest, a dashboard, a
multi-tenant install and a rules engine are all Task 3, and Task 3 is gated on
this one producing money.
