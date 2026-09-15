---
name: close-to-settlement
description: Use when a customer has agreed to pay, when an invoice or payment link is being prepared or sent, when a payment is believed to have arrived, and whenever revenue, earnings or a dollar figure is about to be recorded or reported.
---

# Close to a settlement row

## Overview

`settlements` is the only place revenue exists in this project. An invoice is
not revenue. An agreement is not revenue. A screenshot is not revenue.

**A settlement needs a source someone can re-query and a reference that
identifies the transaction inside it.** `src/money-ledger.js` enforces both, by
construction, and it is not to be worked around.

## Pick the rail the customer actually uses

| Customer | Rail | `source` | `externalRef` |
|---|---|---|---|
| Indian SMB / retailer | **UPI or bank transfer** | `manual_receipt` | the UPI / bank transaction id |
| Overseas individual | PayPal (`paypal.me/joyelgt`) | `paypal` | PayPal transaction id |
| Business with cards | Stripe | `stripe` | the charge id |

The `/20USD` suffix on the PayPal link is left over from a flat-fee model and
must not be used for a contingency invoice.

**Do not make an Indian retailer use PayPal.** The rail the customer already
uses is the rail; a payment friction at the last step is how a closed sale
becomes no sale.

## Minor units — the 100x trap

`grossCents` is a **minor unit**, always.

| Amount | Correct value |
|---|---|
| ₹500 | `50000` |
| ₹12,400 | `1240000` |
| $110 | `11000` |

Pass `currency: 'INR'` — it defaults to `USD` and the default is silent. Getting
this wrong misreports the first revenue this project has ever had, by 100x, in
the direction that flatters us.

## Recording it

```js
await recordSettlement({
  rail: 'tally-leakage',          // the lane, from the registry descriptor
  source: 'manual_receipt',
  externalRef: 'UPI-8842190xxxx', // re-checkable, not invented
  grossCents: 50000,
  currency: 'INR',
  status: SETTLEMENT_STATUS.CLEARED
});
```

Through a revenue job, the **charge stage describes the settlement and the
runner records it** — never call the ledger from a job body.

## Then, in the same commit

- `npm run outreach -- outcome <id> PAID`
- Update `docs/READ-FIRST.md`: it says `settlements` is empty, and that will no
  longer be true. A read-first document that has drifted is worse than none.
- Delete the opt-in assertion in `test/claim-reality-agreement.test.js` that
  asserts the ledger is empty — **do not weaken it, delete it.** It has done its
  job.
- Say the number plainly, once, with its external reference.

## Common mistakes

| Mistake | Reality |
|---|---|
| Recording on invoice | Money has not moved |
| Inventing an `externalRef` | A settlement no external system can confirm is not money |
| `grossCents: 500` for ₹500 | Off by 100x |
| Leaving `currency` at the default | Reports rupees as dollars |
| Announcing revenue before the row exists | The exact fabrication this repo is built to prevent |
