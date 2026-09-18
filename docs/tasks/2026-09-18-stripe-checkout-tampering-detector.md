---
status: open
priority: P2
level: 4
opened: 2026-09-18
---

# Stripe client-side price-tampering / missing-webhook-verification detector

From a prior research pass (`docs/research/NOTES.md`, since overwritten by an
uncommitted export — see the aside in
[2026-09-18-npm-postinstall-supply-chain-detector.md](2026-09-18-npm-postinstall-supply-chain-detector.md)):

> Client-side Stripe Checkout in vibe-coded apps permits price tampering and
> can bypass webhook signature verification because the implementation relies
> on the publishable key and omits server-side validation of the order amount
> and the webhook HMAC signature.

Checked directly, 2026-09-18: no detector for this pattern exists in
`src/codebase-audit.js` (`grep -i "stripe\|webhook"` finds only unrelated
comments about generic URL-shaped inputs).

## Scope

Two related, separable findings — write as one function or two, whichever
keeps each under the file's existing ~50-line-per-detector norm:

1. **Client-trusted amount**: a checkout/payment-intent creation call whose
   `amount` comes from a request body / client-supplied value rather than a
   server-side price lookup.
2. **Unverified webhook**: a Stripe webhook handler (`/api/.../webhook`,
   `stripe.webhooks.constructEvent` absent) that parses the event body without
   calling `stripe.webhooks.constructEvent` (or otherwise checking the
   `Stripe-Signature` header) before acting on it.

Both are CWE-840 (business logic errors) / CWE-345 (insufficient verification
of data authenticity) — pick the accurate CWE per finding when writing the
`why` field, don't reuse the same one for both.

## Why P2

Same reasoning as the sibling Server Action detector opened today: widens scan
coverage, doesn't touch the wedge's actual bottleneck (reply rate on the two
disclosures already sent).

## Done looks like

Function(s) exist, tested against a synthetic client-trusted-amount checkout
call and a synthetic webhook handler missing signature verification (both
fire), and a synthetic correct implementation of each (neither fires), wired
into the same scan path as the other detectors.
