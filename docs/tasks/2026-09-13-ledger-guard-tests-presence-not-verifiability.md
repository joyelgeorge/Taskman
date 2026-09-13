# The ledger guard tests presence, not verifiability

Found 2026-09-13 while tracing the $220 phantom settlement for
`docs/research/2026-09-13-what-flat-confidence-cost.md`. Not fixed there, because
that document's job was to measure rather than to change things.

## What is wrong

`src/money-ledger.js` is the repository's one real integrity control: it refuses
self-reported revenue so that a "$0" here can be believed. `VERIFIED_SOURCES` is
frozen to `stripe | paypal | bank | manual_receipt` (line 74) and line 213 throws
on an empty `externalRef`, stating the reason outright — *"a settlement no
external system can confirm is not money."*

That reasoning is right. The implementation does not achieve it.

Commit `0cee5ec` recorded a **$220 CLEARED settlement for a customer who does not
exist**, and it did **not** bypass the guard. It called `recordSettlement`
correctly:

```js
source: 'stripe',
externalRef: 'pi_fiverr_audit_apex_201_cleared',
grossCents: 22000,
status: SETTLEMENT_STATUS.CLEARED,
verification: { clientConfirmed: true }
```

`'stripe'` is on the allowlist. The reference is non-empty and shaped like a real
Stripe payment intent. Both checks passed. The guard tests **presence and
format-class**; the property it exists to enforce is **verifiability**.

Nothing downstream closes the gap. `src/settlement-verifier.js` exports only
`normalizeStripeTransaction`, `fetchStripeBalanceTransactions` and
`syncStripeSettlements` — all inbound paths that pull what the provider reports.
**No path audits an already-recorded row back against the provider**, so a
hand-recorded reference is never contradicted, because Stripe is never asked.

## Why it matters more than it looks

The whole epistemic position of this repository rests on this function. `docs/READ-FIRST.md`
says the absence of revenue "is real rather than a reporting gap" *because* the
ledger refuses self-reported rows. That argument is only as strong as the guard,
and the guard currently admits any sufficiently well-shaped string.

The cost was not the fabricated row. It was that a rail got marked `PROVEN` and a
week of work was prioritised against a win that never happened.

## What would fix it

In rough order of value:

1. **Reconcile recorded rows against the provider.** A function that takes
   settlements with `source: 'stripe'` and confirms each `externalRef` resolves
   at Stripe; same for PayPal. Anything unresolvable gets flagged, not deleted.
   This is the only check that actually leaves the process, and it is the one
   that would have held.
2. **Separate `manual_receipt` from the machine path.** A settlement a script can
   assert should not be indistinguishable from one a provider confirmed. A
   `verifiedAt`/`verifiedBy` field, empty until step 1 fills it, makes the
   difference visible to everything reading the ledger.
3. **Delete or neuter `scripts/complete-fiverr-audit-settlement.js`.** It still
   exists and will record the fabricated $220 row if run.
4. **`src/autonomous-engine.js` still carries five fabricated opportunities**
   (lines ~40–120) with `escrow: true` and two-decimal `pSuccess` values feeding
   an expected-value calculation. Either source them or remove the numbers;
   invented probabilities propagating into arithmetic is how this started.

## Test it properly

Per the `verifying-guard-tests` skill: the question is not whether the guard is
green, it is whether it can go red. A test for this must attempt to record a
settlement with a plausible-but-fake `externalRef` and **assert that it is
rejected or flagged**. Until such a test fails against today's code, the fix is
not done.
