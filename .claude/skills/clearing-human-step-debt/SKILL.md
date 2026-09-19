---
name: clearing-human-step-debt
description: Use whenever `npm run next` or `npm run guard` shows an OVERDUE criterion or overdue human step, whenever a lane is BLOCKED on something only the operator can do (an account, KYC, a payment link, a post, a reply, a first client), and whenever a session is tempted to pick up build work because "the next step needs the operator". Shrinks the human step until it can be done today, hands it over, then waits.
---

# Clearing human-step debt

## Overview

A step that needs the operator is not an obstacle to route around. It is the
constraint, and usually the only thing between the lane and its first
settlement. It stays undone for a predictable reason: it is uncomfortable, and
building is not. Research on procrastination treats this as choosing short-term
mood repair over the future self's outcome (Sirois & Pychyl, 2013).

The fix is not motivation. It is making the step so small, specific and pre-
decided that starting it costs less than avoiding it. If-then plans do this
reliably, with the largest effect on one-off actions (Gollwitzer & Sheeran, 2006).
See `docs/OPERATOR-GUARDS.md`.

## The procedure

1. **Name the one step.** The oldest overdue commitment criterion first; then
   the cheapest overdue human step inside the commitment. Steps on lanes
   *outside* the commitment are not debt — do not hand those over.

2. **Shrink it until its first action takes under ten minutes.**

   | Too big | Small enough |
   |---|---|
   | "Launch the scanner" | "Paste this 90-word post into Indie Hackers" |
   | "Do a test purchase" | "Open this URL, pay $5 with this card, forward the receipt" |
   | "Find a first client" | "Send this message to the one named person" |

3. **Prepare everything the machine can.** Draft text, exact URLs, the
   payment-link field to fill, the checklist. The operator's part should be the
   part only a person can do: identity, judgement, pressing send.

4. **Hand it over as an if-then plan**, in one message:
   "Tomorrow, first work block, before opening the editor: open `<url>`, paste
   the draft below, press post. About 10 minutes."

5. **Wait.** Do not start build work "while waiting" and call it progress.
   `deciding-the-next-step` covers what legitimately fills the time.

6. **When it is done**, record it where the stores will see it: the outreach log,
   research notes, or the lane's state. An unrecorded ignition step leaves the
   lane looking untried.

## Red flags — you are rationalizing

| Thought | Reality |
|---|---|
| "The operator is busy, I'll build something useful meanwhile" | The debt was built exactly this way, one useful thing at a time. |
| "I'll automate the human step instead" | Platforms require a person for KYC and accounts by their own terms. Automating trust is how lanes died. |
| "A different lane has no human step, let's do that" | That is the routing-around the guard exists to stop. |
| "It's only been a few days" | A one-hour step waiting eleven days is not a scheduling issue. |
| "I'll remind them again" | One clear handover with a pre-decided time beats three reminders. Then wait. |

## When the operator says no

That is an answer. If the step will not be done, the lane cannot settle: mark it
parked or DISPROVEN with the reason, and choose the next lane through
`new-lane-intake-filter`. A lane blocked forever on a declined step is the
most expensive kind of open.
