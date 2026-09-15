---
name: deciding-the-next-step
description: Use when a session starts, when a piece of work finishes, when the user asks what to do next or what is most important, when choosing between open tasks, and whenever an action is about to be started without a stated reason for choosing it over the alternatives.
---

# Deciding the next step

## Overview

Run `npm run next` first. It prints the verified position — money, what is in
flight, open work grouped by what it actually produces. **Decide against that,
never against what the last session remembers.**

Then answer one question out loud:

> **Which settlement row does this produce, and who pays it?**

If the honest answer is *"none directly, but it enables…"*, you are about to
build supply. That is the failure this repository already diagnosed twice, and
it feels productive every time.

## The order

Work the highest band that has an available action. Never skip up.

| Band | Produces | Example |
|---|---|---|
| **1** | A cleared settlement | Invoice a customer who said yes |
| **2** | A named human who has seen the offer | Draft and hand over a disclosure |
| **3** | A lead with a confirmed finding | Verify a lead; fix a detector that lies |
| **4** | Capability | Everything else. **Say the word "maintenance" out loud.** |

Within a band, prefer the warmer distribution: who says yes without a sales
conversation (`relationship_exists` beats `must_create_demand`).

## Waiting is an answer, and usually the right one

**If something is in flight and the window has not elapsed, the next step is to
wait.** `npm run next` says so explicitly, with the days remaining.

This is the hardest output to produce and the one most often replaced with
invented work. Two disclosures sent yesterday cannot be improved by building a
third lead source; they can only be spoiled by a second follow-up. A week of
silence is data. Six hours of silence is not.

While waiting, band 3 and 4 work is legitimate — **as long as it is named as
filling time, not as progress toward the goal.**

## Blocked-on-a-human beats unblocked-and-buildable

A task that needs the operator to send, decide or answer is **not** a reason to
go find something you can do alone. It is the constraint:

> a machine cannot originate a trusted relationship on its own

The useful move is to make that human step cheap and specific — a named person,
a verified finding, a drafted message, a payment link — and then say plainly
that it is waiting on them. Quietly picking up a build task instead is how the
board fills with level-4 work while the ledger stays empty.

## Say the shape of the answer

State three things, briefly:

1. **The action**, one sentence.
2. **Its band**, named: "this is level 4, maintenance."
3. **What it is not**: if it produces no settlement row, say so before starting.

## Red flags — you are rationalizing

| Thought | Reality |
|---|---|
| "I'll build X while waiting for the reply" | Fine — call it maintenance, not progress. |
| "There's nothing I can do until they answer" | There is: verify the next lead, fix a detector that lies. Band 3. |
| "This unblocks revenue later" | Every level-4 task claims this. Which row, and who pays it? |
| "The board has 11 open tasks, I should clear them" | The board is not the goal. Ten of them are maintenance. |
| "One more follow-up won't hurt" | Two follow-ups is spam and costs the lane more than the lead. |
| "I'll pick the task I can finish fastest" | Speed inside band 4 is motion, not progress. |
| "More leads means more chances" | Only if anyone is contacting the leads you have. |

## Common mistakes

| Mistake | Cost |
|---|---|
| Deciding from memory instead of `npm run next` | The position is usually stale in the flattering direction |
| Treating an empty store as a verified zero | `UNKNOWN` is not zero; see `src/store-state.js` |
| Counting a blocked level-1 task as unavailable | It is the constraint, not an obstacle to route around |
| Producing a plan instead of an action | One action. The plan is how band 4 grows |
