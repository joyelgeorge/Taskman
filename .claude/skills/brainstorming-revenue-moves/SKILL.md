---
name: brainstorming-revenue-moves
description: Use when a lane is waiting, blocked or dead, when asking what else could make money, when the current wedge is not converting, and whenever generating or comparing ways to earn from the assets this project already has.
---

# Brainstorming revenue moves

## Overview

Generate money-making options from what exists **today**, then score them. Two
separate steps, and collapsing them is what kills good ideas early.

**Generate without filtering. Gate only at spend and at contact.** An unproven
idea is the raw material of discovery, not a mistake — `src/evidence-tier.js`
exists because filtering novelty was the wrong instinct here once already.

## Step 1 — generate, filter nothing

List every way the current assets could produce a payment. No feasibility
judgement, no "that would never work", no ethics filter, no pricing yet.
**Twenty bad options beat three safe ones**, because the scoring step is cheap
and ideation is where this project has been most conservative.

Prompts that produce different answers:

- Who is already paying someone else for something we can do today?
- What do we produce as a by-product that somebody would buy?
- What is the same capability pointed at a different buyer?
- Who has the problem *and* a budget line for it already?
- What would we sell if we had to invoice something this week?
- Which of our dead lanes died on distribution rather than on capability?

## Step 2 — score, and only now

Four columns. Anything that fails **fulfilment** or **rail** is not an option
however attractive, because it cannot complete.

| Dimension | Question | Kills it if |
|---|---|---|
| **Distribution** | Who says yes without a sales conversation? | Nobody. Cold everything is a 48-attempt experiment, not a plan |
| **Fulfilment** | Can this be delivered without hiring? | The INTERVENE step needs a licensed human |
| **Rail** | Can money actually land? | No payout route the operator can use |
| **Price** | What does the market already pay? | Only the floor is occupied |

Rank by **distribution first** — it is weighted 0.35 in
`packages/core/territory/scoring.js` and it is the only dimension that has ever
blocked this project. `relationship_exists` beats `buyers_already_searching`
beats `findable` beats `must_create_demand`.

## Price from the market, not from comfort

Measured 2026-09-15 in one niche: **$5 to $1,500 for the same work.** Both ends
were occupied by live sellers. This project's recorded price was $80–125,
nearer the floor than the market required, taken from one Fiverr listing.

**Look up what the top of the range actually charges before quoting.** Being
cheap is not a wedge; it is the fastest race in the market.

## Check the registry before proposing

`packages/core/territory/registry.js` records every lane tried, with the reason
it died. A killed lane proposed under a new name wastes the whole exercise —
`isNovel()` catches the obvious aliases. Read the reasons: several died on
**distribution**, which means the capability was fine and a warmer channel would
revive them.

## Output

Three to five options, each one line, with its distribution label and its
price anchored to something real. Then one recommendation and the reason.

**Not a plan.** A plan is how this turns into level-4 work; see
`deciding-the-next-step` for choosing between the options and the rest of the
board.

## Common mistakes

| Mistake | Cost |
|---|---|
| Filtering during generation | The best options get cut before they are scored |
| Scoring on revenue ceiling | Produced the biggest markets with no way in, twice |
| Scoring on how autonomous it is | Produced the most finished machinery here and no revenue |
| Pricing from what feels safe | Leaves 10x on the table; the $1,500 end is public |
| Proposing a lane the registry already killed | The reason is written down; read it |
| Ending with a roadmap | One move, chosen, beats five sequenced |
