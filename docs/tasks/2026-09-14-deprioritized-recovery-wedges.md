---
status: blocked
priority: P3
level: 1
opened: 2026-09-14
---

# The four deprioritized recovery wedges (Stripe, seats, renewals, EMI)

**Priority: P3 — parked as a group.** Raised 2026-09-14
(`taskman-repo-tasks.pdf`, Tasks 4–7). Kept in one file because they are parked
for one reason and will be revisited on one trigger.

All four are the same shape, which is the shape the audit lane already has:
**DETECT a discrepancy → INTERVENE with a draft → VERIFY the customer recovered
money → CHARGE a percentage of it.** None is blocked on being able to build it.
All four are blocked on the same thing: a stranger has to trust an unproven solo
operator enough to grant access.

## Task 4 — Stripe / payment revenue recovery (P2 in source)

Failed charge → automated retry and dunning sequence → verify payment → charge a
percentage recovered.

Deprioritized by the operator with the right reason: it needs a stranger to
connect a **live payment account** to an app with no track record. That is the
highest trust bar of any wedge on the list, against the lowest available
credibility. The Tally case study is the bridge.

Worth knowing before anyone starts: some machinery exists —
`packages/core/orders/`, `packages/core/ledger.js`, the Stripe settlement
verifier, and `test/stripe-webhook-mutex.test.js`. Check before building
(READ-FIRST §Before you start: twice the answer has been "it exists and is
disconnected by one import").

## Task 5 — Unused SaaS seat / licence detector (P2 in source)

Inactive seats via billing API → downgrade recommendation and draft cancellation
→ verify reduced bill → charge a percentage of savings.

Lower trust bar than Stripe (read-only billing access, not money movement),
higher than Tally. **Note the incentive problem:** the buyer is the person whose
budget shrinks, and in a small company that is the same person who approved the
seats. Worth testing the pitch before the detector.

## Task 6 — Silent renewal / renegotiation detector (P2 in source)

Upcoming auto-renewal at a raised price → auto-drafted renegotiation or
cancellation email → one-click human approval → verify the new rate → charge a
percentage of savings.

The cleanest human gate of the four: one click, non-blocking, and it keeps the
send in a person's hands, which is the invariant the rest of this repo runs on.

## Task 7 — Loan / EMI overcharge detector (P3 in source)

Amortisation schedule versus amounts actually charged → dispute letter draft →
human signs and sends → verify correction → charge a percentage recovered.

Informed by the operator's own Sundaram Home Finance dispute. That is a genuine
asset — a documented case where this detection was right — and it is the one
wedge here with a warm first subject.

**But the operator disputing their own loan is not revenue**, and must never be
recorded as a settlement. It is a case study. Keep the two apart; the ledger
already refuses self-reported income by construction, and that protection should
not be argued around.

## The trigger to revisit

One of these becomes worth picking up when the Tally wedge has produced a
settlement and a written case study — i.e. when the credibility that all four
are missing actually exists. Until then, work on any of them is supply-building
against an unvalidated channel, which is the failure this project has already
diagnosed twice.
