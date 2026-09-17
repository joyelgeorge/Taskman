---
status: open
priority: P1
level: 4
opened: 2026-09-17
---

# Nothing reconciles a recorded settlement against the provider

Carried out of `2026-09-13-ledger-guard-tests-presence-not-verifiability.md`,
which was partly fixed on 2026-09-14. This is the half that was not.

Clearing a settlement now requires a **confirmation naming an outside
observation** — `provider_api`, `bank_statement` or `operator_receipt` — and
`verifiedAt` comes from that observation rather than from the caller's own claim.
That closed the category error.

**It does not verify the naming is true.** An `operator_receipt` is a person's
word, by design, because cash has no other record. And `src/settlement-verifier.js`
exports only inbound paths — `normalizeStripeTransaction`,
`fetchStripeBalanceTransactions`, `syncStripeSettlements`. **No function walks
recorded rows and asks the provider whether they exist.**

## Why it is P1 despite being level 4

`docs/READ-FIRST.md` argues the absence of revenue here is real rather than a
reporting gap **because the ledger refuses self-reported rows.** That argument is
exactly as strong as the guard. Everything this project claims about its own
position rests on it, including every honest "$0" in every document written this
week.

## What would fix it

A function that takes settlements with `source: 'stripe'` or `'paypal'` and
confirms each `externalRef` resolves at the provider. Unresolvable rows get
**flagged, never deleted** — a row that cannot be confirmed is a question, not
proof of fraud.

## Testing it properly

Per `verifying-guard-tests`: record a settlement with a plausible but fabricated
reference, run reconciliation against a stubbed provider that does not have it,
and **assert it is flagged.** Confirm that test fails against today's code — it
will, because today there is nothing to call.
