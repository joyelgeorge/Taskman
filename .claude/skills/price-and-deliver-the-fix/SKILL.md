---
name: price-and-deliver-the-fix
description: Use when a prospect has asked what a fix costs or agreed to buy one, when scoping or quoting security remediation work, and when deciding what to hand over as proof that a fix actually worked.
---

# Price and deliver the fix

## Overview

The scan is the marketing. **The fix is the product.** The scan-only niche is
crowded and free; the proven paying work is remediation with evidence it worked.

## Prices that are known to clear

| Offer | Price | Evidence |
|---|---|---|
| Single-issue fix (rotate a key, enable RLS on a table, close a route) | **$80–125** | Fiverr gigs clear at this |
| Full audit + fix of one app | quote from the issue count, not hours | — |
| Recovery-style work (money found, not bugs) | **contingency, ~20% of what they confirm they recovered** | TrueOps 10%, Refully 18%, GETIDA 25% |

Pick contingency when the customer has to hand over something sensitive to start
— a bank export, a ledger. **A stranger will not give an unknown their books for
$20 up front.** Pick a flat fee when the work is bounded and the input is public.

## Scoping rules

- **Quote the issue, not the hour.** "Rotate the exposed key and enable RLS on
  the 12 tables that lack it — $110, done today" beats an hourly estimate.
- **One scope, one price, one deadline.** No tiers on the first sale.
- **Exclude what you cannot verify.** If you cannot test the fix, do not sell it.
- **Never accept production credentials.** Deliver a patch, a migration, and
  instructions. They apply it. This is also why the fix is cheap to deliver.

## What "delivered" means

A fix is delivered when the customer can see it worked:

1. The change itself — a patch, a migration file, a diff.
2. **A re-run of the audit showing the finding is gone.** Same tool, same repo,
   before and after. This is the whole proof, and it is why the detector matters
   more than the report.
3. A one-paragraph note on what is still open, honestly. The upsell is the
   truth, not a teaser.

## Rotation comes first, always

For an exposed secret, the fix is **rotate**, not edit. The value stays in git
history forever; deleting the line changes nothing. If the customer only does
one thing, it is rotation — say so before you quote anything.

## Recording the sale

Do not mark anything earned until money arrives. REQUIRED: use
`close-to-settlement`. An invoice is not revenue, an agreement is not revenue,
and a promise to pay is not revenue.

## Common mistakes

| Mistake | Cost |
|---|---|
| Selling a scan | Competing with free |
| Hourly quotes | Invites negotiation about your speed, not their problem |
| Fixing before the yes | Free work, and it sets the price at zero |
| Delivering without a before/after re-run | They cannot tell you did anything |
| Editing the key out instead of rotating | The credential is still live in history |
