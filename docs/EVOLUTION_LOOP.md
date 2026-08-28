# Taskman Self-Evolving Scheduler

_Last consolidated: 2026-08-28_

Taskman is designed so that every scheduled run adds information to the system. The next run must not behave as if it is the first run.

The scheduler is therefore not just a timer. It is an iterative learning loop.

## 1. Core evolution loop

For each scheduled execution:

```text
Previous Knowledge
      ↓
Current Run
      ↓
New Observations / Results / Failures / Costs
      ↓
Compare Past vs Present
      ↓
Update Knowledge State
      ↓
Infer What Changed
      ↓
Select Better Next Strategy
      ↓
Store Future Path
      ↓
Next Scheduled Run starts from this updated state
```

The important rule is:

> Run N+1 must begin from the validated knowledge created by Runs 1...N, not from the original prompt alone.

## 2. What every run should add

A run may add:

- new factual observations
- changed external conditions
- successful outputs
- failed approaches
- provider reliability evidence
- token/cost information
- latency information
- user feedback/corrections
- newly discovered entities or sources
- repeated patterns
- contradictions with older knowledge
- unresolved questions
- confidence changes
- better search terms
- better execution strategies
- candidate next actions

These should be stored as structured knowledge events, not only as raw chat text.

## 3. Knowledge state

Each task should maintain a current knowledge state derived from its history.

Suggested logical structure:

```json
{
  "known_facts": [],
  "active_assumptions": [],
  "rejected_paths": [],
  "open_questions": [],
  "recent_changes": [],
  "successful_strategies": [],
  "failed_strategies": [],
  "provider_performance": {},
  "constraints": [],
  "current_best_path": null,
  "next_experiments": [],
  "confidence": {}
}
```

The current knowledge state is a derived view. The immutable run/evidence history remains the source of truth.

## 4. Past → Present → Future model

Every run should explicitly reason over three time layers.

### Past

What did we previously know?

- previous conclusions
- previous best path
- previous failures
- previous provider route
- unresolved issues
- previous confidence

### Present

What changed in this run?

- new evidence
- new external data
- success/failure
- contradictions
- better/worse economics
- current system/provider availability

### Future

Given the delta, what should change next?

- continue same strategy
- refine search
- broaden/narrow criteria
- change provider routing
- retry later
- test a competing hypothesis
- stop a dead path
- escalate to user only when required
- schedule the next best experiment

## 5. Delta-first reasoning

A scheduled task should not repeatedly re-process all history from scratch.

Instead:

1. load the last accepted knowledge snapshot
2. execute current run
3. calculate the delta
4. validate the delta
5. merge accepted changes into the new snapshot
6. preserve rejected/contradictory changes separately

This keeps the system efficient and makes its evolution auditable.

## 6. Evolution categories

Taskman may evolve in several dimensions.

### Knowledge evolution

New facts replace or qualify stale facts.

### Strategy evolution

Repeated results may change how the task searches, reasons or sequences its steps.

### Routing evolution

Observed provider quality/cost/reliability may alter future provider ranking.

### Context evolution

Important old context is retained; irrelevant history is compressed or dropped from active context.

### Goal-path evolution

The user's objective stays fixed unless the user changes it, but the route toward that objective can evolve continuously.

This distinction is critical:

> The system may evolve the path, but must not silently evolve the user's goal.

## 7. Self-evolution boundaries

Safe automatic changes:

- reorder providers
- change retry/fallback preferences
- refine search queries
- adjust which historical context is retrieved
- promote repeated observations into stronger confidence
- demote stale/contradicted assumptions
- choose a more promising next experiment
- stop repeating a clearly failed internal approach
- change execution sequence where semantics remain equivalent

Changes requiring explicit approval or policy permission:

- spending more money
- sending/publishing externally
- deleting data
- changing credentials/permissions
- changing the user's objective
- weakening privacy/security constraints
- deploying arbitrary self-written production code

## 8. Avoiding false self-learning

A model saying something does not make it knowledge.

Before merging a new claim into the durable knowledge state, classify it:

- directly observed
- externally verified
- inferred
- hypothesis
- user-provided

Contradictory evidence should reduce confidence rather than being silently discarded.

## 9. Strategy scoring

Each recurring task can maintain strategy candidates.

Example:

```text
strategy_score =
    outcome_quality
  + evidence_gain
  + novelty_gain
  + reliability
  - cost
  - latency
  - repeated_failure_penalty
```

The exact weights should depend on the task objective.

A strategy that repeatedly produces no new information should lose priority unless monitoring for "no change" is itself the objective.

## 10. Exploration vs exploitation

A self-evolving scheduler should not become permanently locked to one method.

Most runs should use the current best strategy (exploitation), while a small controlled fraction may test credible alternatives (exploration).

Exploration must remain inside user constraints and budgets.

## 11. Run lifecycle

Recommended durable lifecycle:

```text
SCHEDULE FIRES
→ LOAD current task version
→ LOAD previous knowledge snapshot
→ SELECT strategy
→ SELECT provider(s)
→ EXECUTE
→ COLLECT evidence
→ COMPARE with previous snapshot
→ CLASSIFY changes
→ VALIDATE updates
→ WRITE new knowledge events
→ BUILD new knowledge snapshot
→ SCORE strategies/providers
→ CALCULATE next best path
→ STORE future intent for next run
→ NOTIFY only if notification condition is met
→ COMPLETE
```

## 12. Suggested persistence model

Future PostgreSQL schema should include concepts like:

```text
knowledge_events(
  id,
  task_id,
  run_id,
  type,
  key,
  value_json,
  source_type,
  confidence,
  observed_at,
  valid_from,
  valid_until,
  supersedes_event_id
)

knowledge_snapshots(
  id,
  task_id,
  run_id,
  snapshot_json,
  created_at
)

strategy_events(
  id,
  task_id,
  run_id,
  strategy_id,
  action,
  score_before,
  score_after,
  reason_json,
  created_at
)

future_paths(
  id,
  task_id,
  based_on_run_id,
  next_strategy_json,
  next_questions_json,
  next_experiments_json,
  created_at
)
```

## 13. Example

User objective:

> Every hour, search for a genuinely actionable opportunity.

### Run 1

Finds 10 candidates. 8 require long lead time. 2 cannot be executed with available tools.

Knowledge update:

- long-lead-time candidates are low value for this task
- available-tool executability matters

Future path:

- filter those classes earlier next time

### Run 2

Uses better filters. Finds 3 candidates. One looks promising but lacks evidence.

Knowledge update:

- candidate category X may be promising
- evidence source Y is needed before acceptance

Future path:

- prioritize category X and validate via source Y

### Run 3

Validation rejects X because of a hidden restriction.

Knowledge update:

- X becomes a rejected path with reason

Future path:

- do not rediscover/recommend X unless new evidence shows the restriction changed

This is genuine evolution: the task becomes progressively less repetitive and more informed.

## 14. Definition of self-evolving for Taskman

Taskman is self-evolving when all of the following are true:

1. each run records structured evidence
2. each run compares new evidence against previous knowledge
3. accepted changes update the durable task knowledge state
4. strategy/provider/context selection can change because of that evidence
5. rejected paths are remembered
6. uncertainty/confidence are tracked
7. the next run starts from the updated state
8. the user's objective and safety constraints remain stable unless explicitly changed

That is the intended core intelligence of Taskman.
