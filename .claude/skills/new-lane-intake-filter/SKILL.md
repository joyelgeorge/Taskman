---
name: new-lane-intake-filter
description: Use whenever a new lane, income stream, wedge, product, side project, trading or crypto idea, or "what if we also..." is proposed — by the operator or by a session — before it gets any code, task file, income_streams row, research pass or brainstorm. Also use when a lane is being revived, when brainstorming-revenue-moves produces a candidate, and when anyone says an idea is "quick to test". Runs the seven operator filters and parks most ideas, by design.
---

# New lane intake filter

## Overview

The stores show one failure more often than any other: when the current lane
needs a human step, a new lane appears. Every new lane feels like progress and
is, usually, the avoidance of the step. This skill exists so that a new idea
meets the filters **before** anyone builds a pedestal for it.

Research and the evidence behind each filter: `docs/OPERATOR-GUARDS.md`.

## The procedure

1. **Write the proposal as a file**, not a paragraph. `/tmp/lane.json`:

   ```json
   {
     "stream_key": "short-slug",
     "title": "What it is",
     "mechanism": "How money arrives",
     "unblocked_by": "human or machine",
     "payingDemandEvidence": "Who already pays for this, where — or omit",
     "killCriteria": [{ "state": "measurable condition", "date": "YYYY-MM-DD" }],
     "ongoingRelationships": false,
     "capitalCapInr": null,
     "replaces": null
   }
   ```

2. **Run it:** `npm run guard -- lane /tmp/lane.json`. Exit 0 admit, 2 park,
   1 reject.

3. **Act on the verdict, and only on the verdict.**

| Verdict | Do | Do not |
|---|---|---|
| ADMIT | Add the income_streams row as TESTING; then `deciding-the-next-step` | Start building before the row exists |
| PARK | One line in `docs/operator/parking-lot.md`; return to the committed lane | Research it "just a little" |
| REJECT | Tell the operator which field is missing; stop | Fill in a kill criterion yourself to get it through |

4. **Say the result in one sentence**, including the filter that parked it:
   "Parked by human-step-debt: the scanner's launch post is overdue."

## If the store is UNKNOWN

`guard` warns when income_streams could not be read. The WIP and debt filters
then ran against nothing and look falsely clear. An ADMIT from that run is not
an admit — say so and stop.

## Red flags — you are rationalizing

| Thought | Reality |
|---|---|
| "This one is different, the upside is huge" | Every parked idea had huge upside. The filter does not score upside. |
| "It's only a quick test" | Three of the four TESTING lanes were quick tests. None were run. |
| "I'll just scope it so the operator can decide" | Scoping is building. Park it; the operator decides at review. |
| "The operator asked for it directly" | Run the filter and show the verdict. They agreed to these guards. Overriding is their call, stated in writing. |
| "It's machine-only, so it costs no attention" | Someone reads its output, fixes its breakages, and thinks about it. Background slot: 1. |
| "It uses capital but only a small amount" | Then set `capitalCapInr`. It is still parked during a commitment. |
| "I can write the kill criteria for them" | A criterion the operator did not choose will not be honoured by the operator. |

## Changing the limits

Limits live in `DEFAULT_LIMITS` and the commitment file. They can change. The
reason is written in the commit message **before** the number moves, never after
a proposal failed against it.
