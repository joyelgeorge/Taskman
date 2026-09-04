# Taskman Minimum First-Customer Integration Stack (#107)

## 1. Frozen Target Stack
To deliver the Fiverr Freelance Reconciliation wedge (#104, #105) without speculative surface sprawl, Taskman freezes the minimum commercial stack:

```text
1. Primary Trigger/Source:
   → Customer upload of monthly Fiverr CSV earnings & withdrawal statement.
2. Execution/Write Path:
   → Local deterministic reconciliation engine (src/commercial-wedge.js).
3. Outcome-Evidence Source:
   → Cryptographically-hashed reconciliation report with line-item fee matching.
4. Billing/Payment Path:
   → Stripe Checkout / Stripe Subscription with automated settlement sync (src/money-ledger.js).
```

## 2. Required Read/Write Capabilities
- `taskman.queue.read` / `taskman.queue.write`: Internal Taskman queue state.
- `commercial.fiverr.reconcile`: Deterministic cross-matching algorithm.
- `stripe.billing.sync`: Authoritative ledger recording via Stripe balance transactions.

## 3. Customer Setup Required
- User uploads statement CSV file via dashboard or API.
- User inputs bank deposit amounts or connects Stripe/bank via read-only statement.
- Zero complex API keys or coding knowledge required from the customer.

## 4. Failure & Degraded Mode Behavior
- If Stripe API is unavailable, reconciliation reports still generate locally and are queued for later subscription billing.
- If statement formats have unrecognized columns, Taskman reports clear validation errors without failing silently.

## 5. Explicitly Deferred Rails
Until the primary wedge achieves 10 paying customers:
- Deferred: Web3/Crypto payment rails (`x402`, `wallet.sign`, `funds.move`).
- Deferred: Speculative gig/bounty rails (`DeskCrew`, `MoltJobs`, `TaskMarket`).
- Deferred: Social media scrapers and automated marketing drones.
