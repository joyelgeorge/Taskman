# Taskman PostgreSQL Persistence

Taskman now supports PostgreSQL as the durable store for its evolving brain.

## What is persisted

- scenarios and their structured data
- tasks and immutable task versions
- triggers/schedules
- scheduled_jobs and scheduled_job_runs (durable scheduler leases and idempotency keys)
- revenue_records and revenue_scan_state (canonical candidate_queue, validation_queue, execution_queue, economic_outcomes, learning_inference)
- runs and run steps
- append-only knowledge events
- derived knowledge snapshots
- strategy changes
- future-path decisions
- providers/model endpoints and health
- token/cost usage events
- money events and attributable value

## Local setup

```bash
docker compose up -d postgres
npm install
export DATABASE_URL=postgres://taskman:taskman_local@localhost:5432/taskman
export PGSSL=disable
npm run migrate
npm start
```

When `DATABASE_URL` is configured, Taskman automatically runs unapplied migrations, applies newer schema-versioned scenario seeds from `data/scenarios.json`, and ensures the canonical `Money Flow Wedge Scout` task/version exists. Existing database-only fields survive; the same seed version is not reapplied on every restart.

When `DATABASE_URL` is not configured, the lightweight POC remains usable with in-memory task/run state and the file-backed knowledge-event fallback.

The dashboard distinguishes executable `tasks` from research `scenarios`. Wide-search candidates, rejected paths and scored leaders are scenario rows; the reusable scheduler job appears as the canonical task.

## Evolution principle

The database is an evidence store, not merely CRUD storage.

Raw events are append-only where practical. Current knowledge is reconstructed from evidence and snapshots. This allows Taskman to answer:

- what did we know before this run?
- what new evidence appeared?
- which belief or path changed?
- what was rejected and why?
- what is the next unresolved gap?
- which strategies/providers are improving?
- did a run create or recover measurable money?

## Core relationship

```text
scenario
  -> task
     -> task_version
     -> trigger
     -> run
        -> run_step
        -> usage_event
        -> knowledge_event
        -> money_event
     -> knowledge_snapshot
     -> strategy_event
     -> future_path
```

The next major persistence step is to turn AI outputs into validated structured events (`fact`, `assumption`, `rejection`, `gap_opened`, `gap_resolved`, `future_path`, `money_event`) rather than storing only a generic run observation.

