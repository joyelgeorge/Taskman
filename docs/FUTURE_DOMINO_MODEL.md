# Taskman Future Domino Model

Taskman should not build a new AI model. The intelligence already exists in external frontier/latest models. Taskman’s job is to orchestrate that intelligence over time.

## Core idea

Each API call should be chosen because it fills the **next most important missing piece** in an uncertain future path.

Think of the task as a chain of invisible domino positions extending into the future:

```text
Known state
   ↓
Gap 1 ?
   ↓
Gap 2 ?
   ↓
Gap 3 ?
   ↓
Desired outcome
```

Taskman cannot see the complete future path in advance. Instead, it repeatedly asks:

> What single piece of information, verification, decision, experiment, or action would reduce the most uncertainty about what should happen next?

That becomes the next API call.

## Not an AI-building project

Taskman should:

- use the best available external AI models through APIs or compatible interfaces
- swap models/providers as better ones become available
- avoid embedding intelligence that providers already supply
- focus engineering effort on memory, orchestration, scheduling, evidence, routing, and next-gap selection

Taskman is therefore an **intelligence orchestration system**, not an intelligence creation system.

## The domino loop

```text
CURRENT KNOWLEDGE
      ↓
Identify highest-value unknown / gap
      ↓
Choose best tool/model/API for that gap
      ↓
Make one targeted call
      ↓
Receive evidence/result
      ↓
Update knowledge and confidence
      ↓
Recompute future path
      ↓
Identify the new highest-value gap
      ↓
Repeat on next scheduler run (or next step)
```

Every call should have a reason for existing.

## Gap types

The next missing piece may be:

- a factual unknown
- stale information that needs refreshing
- a contradiction that needs resolution
- an untested assumption
- missing evidence
- a decision between competing paths
- a feasibility question
- a cost/benefit uncertainty
- a provider/tool capability question
- a missing external action
- an outcome that needs verification

## Call selection principle

Before making an AI/API call, Taskman should score candidate gaps.

Conceptually:

```text
gap_value =
    expected_information_gain
  × relevance_to_goal
  × ability_to_change_next_action
  × urgency
  × confidence_that_gap_is_resolvable
  ÷ expected_cost
```

The highest-value resolvable gap becomes the next domino position to fill.

This is more important than simply generating more text.

## Model selection

After the gap is chosen, Taskman chooses the best current model/tool for that specific gap.

Examples:

- cheap/fast model for classification
- strong reasoning model for ambiguous decisions
- web/search interface for current external facts
- coding model for implementation
- vision model for image/document understanding
- deterministic API instead of AI when a direct data source exists

The system should always prefer the **appropriate intelligence/interface**, not necessarily the same model every time.

## Latest-model principle

Task definitions must never depend permanently on one named AI model.

Saved tasks should describe:

- objective
- constraints
- required capability
- knowledge state
- unresolved gaps

At runtime, Taskman can map those capabilities to the latest eligible model/API available under the user's cost, privacy, and reliability policies.

This lets the app improve automatically as external AI improves, without rebuilding Taskman itself.

## Invisible future path

The future path is not stored as a fixed plan. It is a probabilistic/working path made from:

- current best hypothesis
- unresolved gaps
- dependencies
- rejected paths
- alternative branches
- confidence levels
- next-best experiment

Each result can move the path.

Therefore:

> Plan only as far ahead as evidence supports. Recalculate after each meaningful new piece.

## Example

Goal: find and implement a viable revenue opportunity.

Run 1 asks a frontier model to identify the strongest structural opportunity classes.

New gap: which candidate has actual machine-readable triggers?

Run 2 uses current web/API research to verify triggers.

New gap: can Taskman legally/technically intervene without owning the transaction?

Run 3 asks the best reasoning/research stack to validate integration constraints.

New gap: is there a dominant incumbent already doing it?

Run 4 attacks that uncertainty.

If the candidate fails, it becomes a rejected path and the next-best branch is selected.

If it survives, the future domino moves from discovery to implementation.

The scheduler is therefore progressively constructing the route rather than repeatedly performing the same search.

## Engineering implication

The core Taskman components should become:

1. Goal/constraint store
2. Knowledge/evidence store
3. Gap detector
4. Gap prioritizer
5. Capability resolver
6. Latest-model/provider router
7. API/tool executor
8. Evidence validator
9. Knowledge updater
10. Future-path recomputer
11. Scheduler

The scheduler triggers the loop. It is not itself the intelligence.

## Hard rule

Do not call an AI merely because a scheduled time arrived.

At every execution, first determine:

> Given everything already known, what is the most valuable unresolved domino position now?

Then spend the API call on that.

This is the intended intelligence architecture of Taskman.
