# Task pick — 2026-09-05

Two tracks. Do not mix them.

## Best task to do now

**`first-cleared-settlement`** — Land the first cleared settlement.

The control UI is live. Revenue is $0 because `settlements` has no `CLEARED` row. Logging one real payout (Gig orders → mark paid with bank-net cents, or Stripe sync) is the only task that changes what the dashboard shows.

Runner-up operator task: **`keep-api-and-web-up`** (`npm run api` on :3100 + `npm run web` on :3200, `.env` sourced).

## Best money-flow candidate (not a build decision)

**`cloud-support-plan-right-sizing-engine`** — 46/60, current leader.

```
CANDIDATE: Cloud support-plan right-sizing engine
MODE: SEARCH
THRESHOLD CROSSED: NO

GATES
1. Huge money flow: PASS — AWS/cloud support spend is large and monthly.
2. Recurring measurable leakage: WEAK — plan changes may be annual; 2027 AWS tier consolidation reduces frequency.
3. Machine-readable trigger: PASS — billing forecast + SLO/incident telemetry.
4. Permission to intervene: PASS — recommend only; customer already owns the plan change.
5. Measurable money recovered/created: PASS — support-fee delta is deterministic if a change happens.
6. Tiny fee: WEAK — share-of-savings only if decisions recur; otherwise a small accepted-change fee.
7. Need not own the transaction: PASS — read-only; no plan-change execution.
8. No dominant same-thing solution: WEAK — AWS compare/pricing tools, WhatPlan, DoiT/MSP substitutes.

VERDICT: KEEP SEARCHING
WHY: Still the strongest survivor. Recurrence and whitespace are not proven. First-party plan tools can swallow price comparison.
NEXT ACTION: Quantify real support-tier change frequency and savings; reject if decisions are mostly annual.
```

Do not freeze. Do not build. Runner-ups at 45/60 stay runner-ups.
