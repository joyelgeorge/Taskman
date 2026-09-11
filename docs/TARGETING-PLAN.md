# Targeting plan — getting the first dollar

`docs/WHY-NO-MONEY-YET.md` concludes that the week's work was excellent and
pointed at nobody: a **targeting** failure, not an engineering one. This is the
targeting.

Nothing here needs new code. The one thing built for it is the attempt log
(`npm run outreach`), because without a count this plan cannot be evaluated and
next week's post-mortem is forced to repeat this week's.

---

## P0 — The fastest first dollar is someone who already trusts you

`packages/core/income/defaults.js` records the constraint honestly: *a machine
cannot originate a trusted relationship on its own.* True — and the operator
already has relationships the machine does not.

Anyone selling on Fiverr or Upwork, running a small agency, or who built
something on Lovable, Bolt or v0. One message to a person who already knows you
skips the entire trust problem that contingency pricing exists to solve.

This is not a growth channel. It is how you find out this week, rather than next
month, whether the thing is wanted at all.

## P1 — Choose the lane by loop length, not by asset quality

**The audit tool is the better asset. A security fix is the better first dollar.**

Contingency means: they run it → it finds something → **the platform approves a
refund** → weeks pass → they tell you → they pay 20%. Steps three to five are
outside your control, and step three is a third party's refund process that may
never conclude. A perfect outcome might produce money in six weeks. Some perfect
outcomes produce none.

Contingency solves *"why would I trust you"* brilliantly, and in doing so pushes
the money far away and makes it depend on someone else. Excellent second
product. Poor first dollar.

A fix is money on delivery, for work you control end to end.

## P2 — Sell urgency, not efficiency

An exposed Supabase `service_role` key is an **emergency**: anyone can read and
write the entire database right now. A missing $76 payout is an **annoyance**
people have tolerated for years.

Same outreach effort, conversion differing by an order of magnitude. Urgency is
the highest-leverage variable available and nothing here has been optimised for
it.

## P3 — Go where intent is already stated

Cold scanning finds people who do not know they have a problem *and* have not
asked for help — two conversions where warm inbound needs one. The repo already
knows this; `cron-vibe-lead-sweep.yml` calls `warm-lead-scout` the primary
engine. See `docs/tasks/2026-09-12-primary-lead-engine-is-not-running.md`.

## P4 — One channel, not ten

`src/customer-profile.js` lists ten prospect channels. Ten channels is zero
channels. Pick one, hold twenty real conversations, measure.

## P5 — Price for the first yes

The first dollar's job is to prove a stranger will pay, not to maximise margin.
**$80 that closes beats $572 of contingency that may never arrive.** After one
person has paid, every later conversation is different — and a testimonial
becomes possible, which is the thing currently impossible to write honestly.

## P6 — Instrument before the first message

Twenty messages with no record is one anecdote. Twenty logged messages is a
decision.

```bash
npm run outreach -- log --lane=audit --channel=r/Fiverr --prospect=u/name
npm run outreach -- outcome <id> REPLIED
npm run outreach -- summary audit
```

Requires `DATABASE_URL`; writes refuse without it rather than vanishing into
memory.

## P7 — Write the kill criterion before starting

Committed in advance: **if twenty real conversations in one channel produce zero
paid work, that lane is wrong.** `commercial-wedge.js` already sets fifty as the
formal limit and `outreachSummary` reports progress toward it.

Decided beforehand it is a measurement. Decided afterwards it is a
rationalisation.

---

## The first five days

| Day | Action |
|---|---|
| 1 | List everyone you know in those categories. Message three. Not a pitch — *"I built this, would it be useful to you?"* Log each. |
| 2 | Pick one channel. Read thirty recent posts. Find the three already describing a buying trigger (month-end discrepancy, tax prep, unexplained deduction). |
| 3 | Reply to those three with Draft A from `docs/outreach/audit-lane-first-client.md`. Log each. |
| 4 | Post Draft B where self-promotion is allowed. Log it. |
| 5 | `npm run outreach -- summary <lane>`. Replies, tool runs, anyone who found something. That number decides week two. |

**Zero new code in those five days.** If it works you will know what to build
next. If it does not, you will know which assumption was wrong, which is worth
more than another twenty-six thousand lines.

## What this plan does not know

Which channel converts. That is unknowable from here and only twenty logged
attempts will answer it.

The structural claims — loop length and urgency — are argued from how the
mechanisms work, not from evidence in this repository. If the first twenty
attempts contradict them, they are wrong, and the disproof belongs in
`packages/core/territory/registry.js` beside the other things that were tried.

## An open question worth deciding

Should the audit tool be **free forever as a lead magnet**, with the paid product
being *"I will assemble the claim and chase the platform for you"* at a fixed
fee? That turns a diagnosis into a short-loop deliverable and keeps the trust
advantage of charging nothing to look.

It is a change to the business model rather than a tweak, so it is the
operator's to make — but it is the single change most likely to shorten the path
from a finding to money.
