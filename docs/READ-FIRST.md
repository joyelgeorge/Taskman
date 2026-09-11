# Read this before you write any code

The goal of this repository is **money that has arrived** — a row in
`settlements` with a verified `source` and a real `externalRef`. Not a pipeline
that could produce one. Not a scanner that finds things worth selling. Not a
dashboard reporting potential. A payment, from a person, that cleared.

This document exists because that is easy to forget for weeks at a time, and
because forgetting it is not a mistake anyone notices while it is happening.
Every hour spent here has felt productive. Very little of it has been revenue.

---

## Where we actually are

Verified against the source, not recalled:

- **Six code paths can record a settlement** — `audit-fulfilment`,
  `scan-fulfilment`, `workers/execute`, `autonomous-engine`, `orders`, and the
  Stripe `settlement-verifier`. The machinery is finished.
- **None of them has ever been travelled.** The ledger refuses self-reported
  revenue by construction (`money-ledger.js`: `source` must be stripe, paypal,
  bank or manual_receipt, and `externalRef` must be non-empty), so the absence
  is real rather than a reporting gap.
- **The strongest lane is one human action from live.**
  `payout-audit-direct` is `state: TESTING`, `unblockedBy: 'human'`, and its
  own recorded next action is *"Market the live audit tool to potential audit
  clients to drive first paid settlement."* The tool is already deployed at
  https://taskman-operator.web.app with a working PayPal link.

**So the path to the first dollar is complete and untravelled.** The constraint
is not code. It has not been code for some time.

## The one question to answer before writing anything

> **Which settlement row does this change produce, and who pays it?**

If the honest answer is "none directly, but it enables…", you are building
supply again. That is the failure this project already diagnosed once:

> Taskman built enormous SUPPLY (scanners, drones, scoring, execution
> pipelines) and never validated DEMAND — a real person demonstrably paying —
> before building each one. Every lane died at the payment step, not the
> technical step.

Improving the machine is not forbidden. Mistaking it for progress toward the
goal is. Both can be true: a change can be worth making *and* be zero dollars.
Say which one it is, out loud, before starting.

## What counts as progress

In descending order. Only the first is the goal.

1. **A cleared settlement.** A real payment, recorded through
   `recordSettlement`, with an external reference someone could check.
2. **A named human who has seen the offer** and has the problem it solves.
   A specific person or business, not a market segment.
3. **A lead with a confirmed finding** — a real repository, a real weakness,
   something concrete enough to disclose. The vibe-app sweep produces these.
4. **Capability that a named lead is waiting on.** Not capability in general.

Anything not on this list is maintenance. Maintenance is fine. Label it.

## What the machine cannot do

This is the load-bearing constraint, and it is recorded in the code itself:

> `payout-leakage-audit` — **BLOCKED**: software is ready; the missing input is
> one trusting client — *a machine cannot originate a trusted relationship on
> its own.*

No amount of engineering removes this. Somebody has to put a working thing in
front of a person who has the problem. Every lane currently marked BLOCKED is
blocked on a human step — KYC, an introduction, a first message — and none of
them is blocked on a feature.

The useful thing code can do is make that human step **cheap and specific**:
a named business, a confirmed finding, a drafted disclosure, a payment link.
Then a person sends it. That is the whole handoff.

## Before you start

1. Read §14 of `docs/BRAIN-TRANSFER.md` — the disproof registry. Most of the
   value there is what **not** to try again, and why. Lanes are recorded dead
   with their reasons precisely so they are not rediscovered next quarter under
   a new name.
2. Check whether the thing you are about to build already exists. Twice now the
   answer has been "yes, and it is disconnected by one import." The leads table,
   the marketing store and the scanner all existed while the sweep was writing
   its results to `/tmp` and losing them.
3. State which of the four progress levels your change targets.
4. If the answer is 1 or 2, proceed. If it is 3 or 4, say so plainly and keep
   it small.

## Honest note about this document

Writing this produced no revenue either. Its only justification is that the
next person — or the next model — starts from the real position instead of
rediscovering it in week three. If it stops being accurate, correct it in the
same commit as whatever made it wrong; a read-first document that has drifted
is worse than none, because it is trusted.

`settlements` is empty. Everything else is commentary.
