# Taskman Money-Task Core

_Last consolidated: 2026-08-28_

## Core objective

Taskman is not an AI model and does not need world-scale knowledge. Its purpose is to use the best currently available AI models and APIs as external intelligence to identify and complete **doable money-making tasks** with as little setup as possible.

The preferred pattern is:

> one-time setup → repeated autonomous execution → accumulated knowledge → progressively better task selection and fulfillment → measurable money outcome

## 1. Relevance over total knowledge

Taskman should not load or reason over everything it knows.

For each task, retrieve only the smallest relevant knowledge slice needed to decide the next action.

This means:

- do not send the full task history when a compact current state is enough
- do not research the whole market when one unresolved constraint is blocking execution
- do not call a frontier model when a cheaper model can reliably resolve the current gap
- do not repeatedly rediscover facts already stored with adequate confidence
- do not preserve irrelevant history in active context merely because it exists

The system should treat context as a scarce resource.

## 2. Economic task definition

A candidate is valuable when AI and available tools can materially advance it toward money with low human intervention.

Useful characteristics:

- existing demand or existing money flow
- specific executable work
- machine-readable or discoverable trigger
- output can be created, validated, submitted, published, delivered, optimized, recovered, or acted upon through available interfaces
- limited one-time setup
- recurring or repeatable value after setup
- measurable outcome
- low ongoing manual burden

Avoid opportunities that are mainly ideas, vague recommendations, jobs requiring ongoing human labor, or projects with long uncertain lead times unless the expected payoff justifies them.

## 3. One-time setup principle

Human effort should concentrate at the boundary once:

- authorize an account
- provide credentials
- approve a business rule
- define a payment destination
- create a required profile/store/listing/account
- approve a recurring side effect

After that, Taskman should reuse that setup rather than asking again.

Persist setup state and permission scope separately from task-run context.

## 4. Money-task loop

```text
USER GOAL: MAKE MONEY
        ↓
LOAD accumulated relevant knowledge only
        ↓
IDENTIFY the highest-value unresolved money gap
        ↓
ASK the best available AI/API only what is needed for that gap
        ↓
VALIDATE whether the result is executable now
        ↓
IF executable: perform the allowed action
IF not executable: identify the exact blocker
        ↓
MEASURE outcome / new evidence
        ↓
UPDATE durable knowledge
        ↓
UPDATE rejected paths and successful patterns
        ↓
SELECT next highest-value gap
        ↓
NEXT RUN
```

## 5. Gap selection

Each API call should exist for a reason. Before calling an AI/model/tool, Taskman should be able to state internally:

- what exact uncertainty/blocker this call resolves
- why resolving it matters to the money outcome
- what output format is required
- what action becomes possible if resolved

A useful conceptual priority score:

```text
next_gap_score =
    expected_money_impact
  × probability_of_resolution
  × executability
  × reuse_value
  / expected_cost_and_time
```

This is not a fixed formula; it represents the optimization target.

## 6. Task categories

The architecture should remain general, but attractive task families include cases where AI can repeatedly:

- detect a financial opportunity or leakage
- generate a deliverable already demanded by a buyer/platform
- optimize an existing transaction/conversion flow
- recover failed or missed value
- monitor for a profitable state change
- transform available data into a monetizable output
- operate a repeatable digital workflow after credentials/setup exist

The core test is not whether AI can discuss the task. The test is whether Taskman can **fulfill enough of the task through interfaces to cause or materially advance a money event**.

## 7. Use the latest intelligence, not a fixed model

Taskman should not embed its product identity in one model.

At each gap:

1. classify the capability required
2. inspect currently available providers/models
3. choose the best eligible option based on quality, cost, latency, context need, reliability and tool support
4. execute the narrow call
5. record outcome quality
6. improve future routing

When better AI models become available, Taskman should benefit by updating its provider catalog/routing policy, without rebuilding its core product.

## 8. Minimal-context intelligence

The ideal request package for an AI call is:

```text
GOAL
CURRENT STATE
RELEVANT VERIFIED FACTS
CURRENT BLOCKER / GAP
CONSTRAINTS
REQUIRED OUTPUT
```

Everything else stays outside the prompt unless it becomes relevant.

The knowledge store is therefore larger than the active context window. Retrieval selects only what helps solve the current domino.

## 9. Economic learning

Taskman should learn not only factual knowledge but economic usefulness.

For each strategy/task family/provider, track signals such as:

- money generated or recovered
- probability of eventual money outcome
- time-to-money
- number of API calls required
- model/API cost
- setup burden
- manual intervention count
- repeated failure/no-action rate
- reuse across future opportunities

A clever result that never reaches an executable money path should lose priority.

## 10. Definition of success

The desired end state is not a large autonomous AI system.

It is a small persistent orchestration system that can say:

> I know the objective, I know what has already been tried, I know what setup is already available, I know the most valuable missing piece now, and I know which current intelligence/tool can fill that piece with the least waste.

Then it executes, learns, and repeats.
