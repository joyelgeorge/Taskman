# Task pick — 2026-09-05

Two tracks. Do not mix them.

Catalog: [`data/tasks.json`](./tasks.json)

## Best task to do now

**`first-cleared-settlement`** — rank **92**. Land the first cleared settlement.

The operator UI Connects to this origin by default. Revenue tiles are settlement-`CLEARED` only. Preview seed orders (FO-10421 / FO-10408 / FO-10455) are not live Neon rows. Logging one real payout (Gig orders → minutes required → mark paid with bank-net cents, or Stripe sync) is the only task that changes what the live dashboard shows.

Operator queue behind it:

| Rank | Id | Do |
| ---: | --- | --- |
| 92 | `first-cleared-settlement` | **Pick.** One CLEARED row on live Neon. |
| 71 | `unstick-satellite-scan` | Run the overdue cron; do not leave it silent. |
| 68 | `default-connect-this-origin` | Prefill API URL with this origin; auto-Connect. |
| 64 | `drop-forum-radar` | Keep disabled until fail streak is 0. |
| 60 | `require-minutes-on-orders` | Reject orders without minutesSpent > 0. |
| 55 | `keep-api-and-web-up` | Same origin for UI + `/api/*`. |

## Best money-flow candidate (not a build decision)

**`cloud-support-plan-right-sizing-engine`** — 46/60, current leader. **KEEP SEARCHING.**

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
