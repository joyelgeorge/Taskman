# Taskman Consolidated Orchestration Pipeline

_Last consolidated: 2026-08-29_

Taskman's revenue/income automation is now organized around reusable engines rather than separate overlapping agent brains.

## Core pipeline

```text
DISCOVER -> VALIDATE -> EXECUTE -> LEARN -> DISCOVER
```

The scheduled workers are deliberately narrow:

- **Taskman Discover** owns discovery, normalization, deduplication and deterministic qualification.
- **Taskman Validate** owns adversarial evidence checks and promotes only validated candidates downstream.
- **Taskman Execute** owns safe external action, setup/capability checks and economic outcome recording.
- **Learning is event-driven**, not a fourth scheduled worker. Every stage writes reusable inference/evidence.

## Canonical queues

```text
candidate_queue
validation_queue
execution_queue
economic_outcomes
learning_inference
```

Legacy revenue queue names resolve to canonical queues where they represent the same concept:

- `revenue_exploration_queue` -> `candidate_queue`
- `revenue_opportunity_deepdives` -> `validation_queue`
- `revenue_execution_results` -> `economic_outcomes`
- `revenue_scan_inference` -> `learning_inference`

This keeps older clients compatible while new workers use the generic pipeline.

## Discovery sources are plugins

A discovery source finds candidates; it does not own qualification, validation, execution or learning policy.

Current source families:

- `recent_events`
- `credible_writers`
- `model_inference`
- `structural_money_flow`
- `bounty`
- `immediate_income`

All sources normalize to a shared candidate shape:

```json
{
  "candidateId": "...",
  "sourceType": "...",
  "profile": "...",
  "noveltyKey": "...",
  "title": "...",
  "moneyFlow": "...",
  "trigger": "...",
  "estimatedValue": null,
  "evidence": [],
  "sourceTimestamp": null,
  "confidence": 0,
  "metrics": {},
  "requiredCapabilities": [],
  "nextValidation": null
}
```

## Qualification profiles

The same qualification engine applies different profiles rather than duplicating scoring logic in prompts.

### programmable_money_flow_v1

Strongly weights flow scale, recurring leakage/value, independent machine-readable trigger, permission, delta measurability, monetization, execution autonomy and competitive whitespace.

All eight structural gates remain hard requirements before a money-flow hypothesis crosses the build threshold.

### bounty_execution_v1

Strongly weights payout certainty, acceptance clarity, execution autonomy, time-to-money and reusable execution rails.

### immediate_income_v1

Requires an existing payer/demand, credible payout, real submission/delivery route and post-setup autonomous execution.

## Capability registry

Workers should query shared capability state instead of repeatedly rediscovering setup blockers.

Endpoint:

```text
GET /api/capabilities
```

Current baseline capabilities include web read, GitHub read/write, Gmail send, Taskman queue read/write and MoltJobs read. Authenticated MoltJobs capability is derived from the runtime secret. Wallet signing and fund movement default to unavailable.

Candidate records can declare `requiredCapabilities`. Validation and execution then calculate missing capability keys deterministically.

## Orchestration configuration API

```text
GET /api/orchestration/config
```

Returns:

- pipeline stages
- canonical queues
- legacy aliases
- discovery sources
- qualification profiles

## Qualification API

```text
POST /api/qualification
```

Accepts a candidate plus optional profile/capability overrides and returns:

- normalized candidate
- deterministic qualification score
- threshold
- hard-gate failures
- missing capabilities

## Worker responsibilities

### Discover

1. read current learning/state
2. invoke enabled source plugins
3. normalize
4. retrieve/reuse existing evidence
5. deduplicate
6. qualify using the appropriate profile
7. rank
8. enqueue candidates
9. update source-performance learning

Discover does **not** perform external candidate execution.

### Validate

1. claim candidates
2. retrieve existing evidence
3. research only missing/stale/contradictory facts
4. attack the candidate using its profile
5. classify candidate
6. reject/requeue/promote to execution
7. write learning inference

Validation outputs may be `REJECTED`, `NEEDS_EVIDENCE`, `PROMISING`, `EXECUTABLE`, `SETUP_REQUIRED` or `THRESHOLD_CROSSED`.

### Execute

1. claim validated executable work
2. re-check stale assumptions only when needed
3. inspect capability registry
4. perform next safe executable action
5. record deliverable/result/blocker
6. record attributable value/payout status
7. feed rail reliability/setup friction/economic outcome back into learning

Execution outputs may be `ADVANCED`, `COMPLETED`, `VALUE_CREATED`, `MONEY_EVENT`, `SETUP_REQUIRED`, `BLOCKED`, `REVALIDATE` or `REJECTED`.

## Evidence reuse

Research should be gap-driven. A worker should reuse valid evidence already present in Taskman's knowledge/queue state and fetch only missing, stale or contradictory evidence.

This avoids repeated searches for the same facts and allows the system to become cheaper and more precise over time.

## Learning

Learning is shared across the entire pipeline. Each learning record should include evidence count, confidence and either:

- `TEMPORARY_HINT` — changes weights/search emphasis without hard exclusion
- `DURABLE_RULE` — may become a persistent rule only with strong evidence

Old guidance should be periodically classified as useful, misleading or inconclusive so the system can self-correct.

## Durable Scheduler Architecture

```text
Cron triggers.
PostgreSQL coordinates.
Taskman owns run state.
Workers are reusable/stateless where possible.
```

### Schedule Cadence (Staggered Hourly Defaults)

- `:00` (`0 * * * *`) — **Taskman Discover**: Scan sources, normalize hypotheses, qualify with hard gates, enqueue into `candidate_queue`.
- `:10` (`10 * * * *`) — **Taskman Validate**: Claim candidates, reuse evidence, perform adversarial checks, promote to `validation_queue` and `execution_queue`.
- `:20` (`20 * * * *`) — **Taskman Execute**: Claim executable items, check capability registry, run deterministic actions, record in `economic_outcomes`.

### Coordination & Durability

1. **PostgreSQL Coordination**: Atomic lease acquisition via `FOR UPDATE SKIP LOCKED` on `scheduled_jobs`.
2. **Idempotency Keys**: Each scheduled firing generates a deterministic `run_key` (`{jobId}:{YYYY-MM-DDTHH:MM:00Z}`) recorded in `scheduled_job_runs`.
3. **Lease Expiry & Crash Recovery**: Crashed workers release their lease after expiry (`lease_expires_at <= now()`), allowing automatic recovery without duplicate executions.
4. **Bounded Catch-Up**: On restart, overdue firings execute at most once before calculating the next future interval.
5. **Memory Fallback**: When `DATABASE_URL` is omitted, an in-memory scheduler operates for local development, clearly reporting non-durable mode.

### Controlled Internal Scheduler Cutover

To run the internal scheduler loop inside the Taskman process:

```bash
export TASKMAN_INTERNAL_SCHEDULER_ENABLED=true
```

Or trigger individual worker runs via OS cron / external orchestrators:

```bash
# Crontab example
0 * * * *   cd /path/to/taskman && node src/worker.js discover
10 * * * *  cd /path/to/taskman && node src/worker.js validate
20 * * * *  cd /path/to/taskman && node src/worker.js execute
```

### Worker Entrypoints

- CLI: `node src/worker.js <discover|validate|execute|all>`
- Individual workers:
  - `node src/workers/discover.js`
  - `node src/workers/validate.js`
  - `node src/workers/execute.js`
- API endpoints:
  - `GET /api/scheduler/jobs`
  - `POST /api/scheduler/jobs/:workerName/trigger`

## Why this replaces overlapping agents

The former Money Flow Wedge Scout and TaskBounty Queue Watch scheduled jobs are absorbed as discovery-source/profile combinations. The former Autonomous Income Engine becomes Taskman Execute. Revenue Explorer becomes Taskman Discover. Opportunity Deep Dive becomes Taskman Validate.

Instead of multiple large prompts each implementing their own search, scoring, validation and execution logic, Taskman now centralizes those concerns into reusable code and narrow worker roles.

