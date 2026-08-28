# Taskman Brain Architecture

_Last consolidated: 2026-08-28_

## 1. Purpose

The Brain is the decision layer that sits above Taskman's data, scheduler, providers and tools.

Taskman does not build a new AI model. It uses the best available external intelligence and APIs to continuously answer one question:

> What is the next most valuable missing piece that can move the system closer to a real, executable money outcome?

The Brain exists to select that next piece.

## 2. Core operating model

```text
GOAL: generate money from doable AI-assisted tasks
        ↓
CURRENT KNOWLEDGE STATE
        ↓
IDENTIFY unresolved gaps
        ↓
RANK gaps by expected money progress
        ↓
SELECT smallest useful next action
        ↓
SELECT best current model/API/tool
        ↓
EXECUTE one bounded step
        ↓
OBSERVE result
        ↓
UPDATE knowledge + strategy scores
        ↓
RECALCULATE next gap
        ↓
repeat
```

The Brain should prefer a sequence of small validated advances over large speculative plans.

## 3. Brain inputs

The Brain should consume structured data from these stores:

### Goal state

- primary objective
- money target / success condition
- user constraints
- permitted side effects
- budget policy

### Knowledge state

- verified facts
- assumptions
- hypotheses
- rejected paths
- open questions
- current best path
- prior outcomes

### Opportunity state

- identified money tasks
- estimated value
- expected time to first money event
- setup burden
- recurring potential
- executability
- required APIs/tools/accounts
- current blocker

### Execution state

- provider availability
- tool availability
- credentials available/not available
- latency
- cost
- quota headroom
- failure history

### Learning state

- strategies attempted
- strategy scores
- provider performance
- repeated failure patterns
- evidence gained per call
- user feedback

## 4. Brain output

Every Brain cycle should return a structured decision object similar to:

```json
{
  "current_goal": "...",
  "current_best_path": "...",
  "next_gap": {
    "id": "gap-123",
    "description": "...",
    "why_it_matters": "...",
    "required_capability": ["web_research", "reasoning"],
    "expected_information_gain": 0.8,
    "expected_money_progress": 0.7,
    "estimated_cost": 0.01,
    "estimated_setup_burden": 0.1
  },
  "action": {
    "type": "ai_call",
    "tool": "provider-router",
    "instruction": "..."
  },
  "stop_condition": "...",
  "next_if_success": "...",
  "next_if_failure": "..."
}
```

## 5. Gap model

A gap is a missing fact, missing capability, missing connection, missing validation, missing asset, or missing action that blocks progression toward a money event.

Examples:

- Is the opportunity real and current?
- Is there already a dominant incumbent?
- Is an API available?
- Can Taskman perform the required action autonomously?
- What permission is missing?
- Can value be measured objectively?
- Can payment/revenue be collected without holding customer funds?
- Is the setup reusable after one configuration?
- What exact deliverable would cause the next money event?

The Brain should avoid asking broad questions when a narrow gap is sufficient.

## 6. Gap ranking algorithm

Initial heuristic:

```text
GapScore =
    0.28 * money_progress
  + 0.20 * executability
  + 0.16 * information_gain
  + 0.12 * probability_of_success
  + 0.10 * reusability
  + 0.08 * urgency
  + 0.06 * reversibility
  - 0.12 * setup_burden
  - 0.10 * monetary_cost
  - 0.08 * latency
  - 0.10 * uncertainty_without_validation
```

Weights are configurable and should eventually learn from actual outcomes.

The most important ranking rule is not raw information gain. It is information or action that materially reduces distance to money.

## 7. Opportunity scoring

A candidate money task should be ranked using a separate score:

```text
OpportunityScore =
    expected_value
  * probability_executable
  * recurrence_multiplier
  * automation_fraction
  * attribution_clarity
  / (setup_cost + time_to_money + operational_friction + risk)
```

The Brain should strongly prefer opportunities with:

- existing demand or money flow
- machine-readable triggers
- objective output/value
- one-time setup
- repeatable execution
- low marginal human work
- API/tool accessibility
- measurable path to revenue

## 8. One-time setup principle

A good task may require initial setup such as:

- connecting an API
- creating a credential
- configuring a webhook
- defining a workflow
- creating a reusable asset
- registering an account

The Brain should distinguish setup from recurring work.

High-value target:

```text
one-time setup
→ repeated autonomous execution
→ repeated measurable output
→ repeated money events
```

A task that requires equivalent manual setup every run should be penalized.

## 9. Minimal relevant context

Do not send the entire knowledge base into every AI call.

Before each call, construct a context packet containing only:

1. immutable goal and hard constraints
2. current best path
3. current gap
4. facts relevant to that gap
5. rejected paths that prevent repetition
6. required output schema

This is the Brain's relevance filter.

## 10. AI layers

The Brain may use multiple external AI calls with distinct roles rather than one giant prompt.

Possible layers:

### Layer A — Gap detector

Find the most important unresolved blocker.

### Layer B — Researcher / solver

Resolve that blocker using the best model/tool combination.

### Layer C — Critic

Attack the proposed conclusion and look for invalid assumptions.

### Layer D — Integrator

Merge validated evidence into knowledge state.

### Layer E — Planner

Recalculate the future path and next gap.

Not every cycle needs all layers. Use only those justified by expected value.

## 11. Model independence

The Brain should never encode product logic around one named model.

It requests capabilities such as:

- frontier reasoning
- cheap classification
- long context
- web research
- coding
- structured extraction
- vision

The router maps those capabilities to the best currently available provider/model.

Therefore Taskman benefits automatically as external AI improves.

## 12. Evidence hierarchy

When deciding whether to update durable knowledge, prefer:

1. directly observed system/API result
2. primary external source
3. corroborated independent sources
4. model inference supported by evidence
5. unsupported model hypothesis

Unsupported hypotheses may guide exploration but should not become durable facts.

## 13. Anti-loop logic

The Brain must detect unproductive loops.

Penalize a strategy when:

- it repeatedly returns the same result
- it discovers no new evidence
- it revisits a rejected path without new conditions
- it consumes cost without reducing a blocker
- it creates analysis that cannot be acted on

After a configurable threshold, force a strategy change or mark the path exhausted.

## 14. Money-event states

Each candidate path should progress through explicit states:

```text
DISCOVERED
→ QUALIFIED
→ VALIDATED
→ EXECUTABLE
→ SETUP_REQUIRED
→ READY
→ RUNNING
→ VALUE_CREATED
→ MONEY_EVENT
→ REPEATABLE
```

A candidate may also become:

```text
REJECTED
BLOCKED
STALE
WAITING_USER
```

The Brain's primary objective is to advance candidates toward MONEY_EVENT and REPEATABLE, not merely produce research.

## 15. Stop / escalate rules

The Brain should stop autonomous progression and ask for user involvement only when the next gap genuinely requires something it cannot perform, such as:

- a login/permission that has not been granted
- legal acceptance
- payment authorization
- identity verification
- irreversible external action requiring approval

When escalation is necessary, it should ask for the smallest possible user action, ideally with an exact clickable link.

## 16. First implementation target

The first coded Brain does not need advanced ML.

V0 can be deterministic:

1. store candidate opportunities and gaps
2. calculate heuristic scores
3. pick the highest-ranked unresolved gap
4. build a minimal context packet
5. route it to an external AI capability
6. parse structured result
7. append evidence
8. update candidate state
9. calculate next gap

Later, actual run outcomes can tune weights and strategy selection.

## 17. Definition of success

The Brain is working when it can take an initial broad objective and progressively convert it into:

```text
unknown future
→ explicit gaps
→ targeted intelligence calls
→ verified knowledge
→ executable setup
→ autonomous repeated task
→ measurable value
→ money event
```

without repeatedly restarting its reasoning or requiring the user to manually direct every step.
