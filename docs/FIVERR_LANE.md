# The Fiverr bookkeeping lane

_Lane chosen 2026-09-03 — see issue #135 for why this one and not the other two._

This is the operating runbook for the first rail that is meant to actually earn
money, plus the gig listing draft to publish. Everything here assumes the
discipline the rest of the system already enforces: sell it once by hand before
automating any part of it.

## Before anything else — what only you can do

1. **Create the Fiverr seller account.** Your identity, your KYC, your payout
   details. This system does not create accounts and never will.
2. **Publish one gig** using the draft below, edited to be true of you.
3. **Take the first order and do the work yourself**, timing it honestly.

Nothing in this repo needs to run for step 1–3 to happen. That is the point.

## The gig listing draft

Edit every line of this to be true. Delete anything you cannot stand behind —
an inflated claim is not just dishonest, it is the fastest route to a dispute,
a refund, and a dead account.

### Title

> I will reconcile your bookkeeping transactions and flag every mismatch

Alternatives worth testing later, one at a time:
- *I will clean up and categorise your Shopify or Stripe transaction exports*
- *I will reconcile your bank statement against your books and find the gaps*

### Category

Business → Financial Consulting → Bookkeeping (or Data → Data Entry, if the
bookkeeping category asks for credentials you do not have — do not claim a
certification you have not earned).

### Pricing tiers

| Tier | Price | Scope | Delivery |
|---|---|---|---|
| Basic | $20 | Up to 100 transactions. Categorised, reconciled against one statement, mismatches listed. | 2 days |
| Standard | $45 | Up to 400 transactions, plus a summary of what did not reconcile and why. | 3 days |
| Premium | $90 | Up to 1,000 transactions, multi-account, plus a short written note on recurring problems in the data. | 4 days |

Start at the low end. The first three orders are for the review, not the money —
a five-star review at $20 is worth more right now than one $90 order and no
history. Raise prices once the effective hourly rate in the dashboard tells you
the work is actually taking less time than the price assumes.

### Description

> **What you get**
>
> Send me your transaction export (CSV from your bank, Stripe, Shopify,
> PayPal, or your accounting software) and the statement you want it checked
> against. I return a clean, categorised spreadsheet with every transaction
> reconciled, and a clear list of anything that did not match — duplicates,
> missing entries, amount mismatches, and uncategorised items.
>
> **What I need from you**
>
> - Your transaction export (CSV or Excel)
> - The statement or account balance to reconcile against
> - Your category list, if you already have one — otherwise I will use a
>   standard set and you can rename anything
>
> **How I work**
>
> I use software and automation to do the mechanical parts fast — matching,
> categorising, flagging — and I check the result myself before sending it.
> That is why the turnaround is quick and the price is low. Every mismatch I
> report is one I have looked at.
>
> **What I do not do**
>
> I am not a licensed accountant and this is not tax advice, an audit, or a
> financial opinion. This is bookkeeping data work: reconciliation,
> categorisation, and clearly flagged exceptions. If something needs a CPA, I
> will tell you rather than guess.
>
> Revisions are free until the reconciliation is right.

### FAQ

**Can you work with my accounting software?**
Send me an export in CSV or Excel and I can work with it. I do not need access
to your accounts, and I would rather not have it.

**Is my data safe?**
Send only what the job needs. Please remove full card numbers and personal
identifiers before sending — I do not need them to reconcile transactions, and
you should not send them to any freelancer who does not strictly require them.

**What if the numbers don't reconcile?**
That is usually the actual value of the job. You get a clear list of what did
not match and why, which is what you need in order to fix it.

### On disclosure — read this before you publish

The "How I work" paragraph above says plainly that automation does the
mechanical parts and that you check the result. Keep that. Two reasons, and
the second matters more:

1. Fiverr's terms and buyer expectations around AI-assisted delivery keep
   moving. A listing that already says how the work gets done cannot be
   accused later of hiding it.
2. It is true. A buyer paying $20 for a reconciliation is buying a correct
   spreadsheet and someone accountable for it, not a specific number of human
   keystrokes. Saying so honestly costs you nothing and protects the account
   that this whole lane depends on.

What you must not do: claim credentials you do not hold, promise an accuracy
figure you have not measured, or invent a client history. The first review is
worth more than any of those and you only get it by delivering.

## Recording the work — why it matters more than it looks

Log every order in the dashboard, including the minutes. The system refuses an
order without a time — deliberately. Cleared revenue per order will make this
gig look fine at $20 a job. **Effective hourly rate is the number that tells
the truth**, and it only exists if the minutes are honest, including the ones
spent on revisions and on messages back and forth with the buyer.

```bash
# or use the "Log order" form in the dashboard
curl -X POST $API/api/orders -H 'content-type: application/json' \
  -d '{"orderId":"FO-1001","priceCents":2000,"minutesSpent":35,"notes":"Shopify Aug reconcile"}'

# when Fiverr actually deposits — gross before their cut, then the fee
curl -X POST $API/api/orders/FO-1001/payout -H 'content-type: application/json' \
  -d '{"grossCents":2000,"feeCents":400}'
```

Payouts are recorded with source `manual_receipt` and the Fiverr order ID as
the external reference. That is the weakest of the ledger's three verification
sources — Fiverr pays via PayPal/Payoneer/bank and only Stripe has an automated
verifier here. The order ID is mandatory precisely because it is the one thing
that can be checked back against the marketplace later.

## What the numbers should tell you, and when to quit

The rail governor already applies to this rail: $50 of recorded cost or 25
attempts with nothing cleared and it disables itself. But for a gig lane the
kill signal will almost certainly be effective hourly rate, not the governor.

- **Below ~$15/hr effective after five paid orders** — the gig is not worth
  your time as priced. Raise prices or narrow the scope, once. If it does not
  move, this lane is answered and the honest thing is to say so.
- **$25–40/hr and rising as you get faster** — this works. Keep going, raise
  prices, and only then consider the marketing wing (#130–133) to sell the same
  service off-platform where Fiverr does not take a cut.
- **Nothing cleared after three weeks of a live listing** — the listing is not
  being found. That is a positioning problem, not a delivery problem, and no
  amount of software fixes it.

## What is deliberately not built yet

No lead generation, no outreach drafting, no campaign automation. Fiverr's own
marketplace supplies buyer discovery for the first sale, which is exactly why
this lane was chosen over the other two. The marketing wing (#129, #130–133)
stays on the shelf until there is a first order and a real effective hourly
rate to scale.
