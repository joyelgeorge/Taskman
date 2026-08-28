# Taskman

Taskman is a lightweight API-only task scheduler and orchestration app with a **self-evolving knowledge loop**.

## What it does

- Accepts plain-language tasks.
- Runs tasks manually or on a recurring interval.
- Routes AI work across interchangeable API providers.
- Falls back when a provider fails.
- Keeps task history and execution context.
- Tracks provider, token usage, estimated cost, and run status.
- Produces a concise next-best-action after each run.
- Uses external APIs only; no local AI model is required.
- Evolves each recurring task from accumulated evidence instead of restarting from the original prompt every time.

## Core idea: every run learns

A scheduled run should follow:

```text
previous knowledge
→ current execution
→ new evidence
→ compare past vs present
→ update knowledge
→ choose the better future path
→ next run starts from that updated state
```

The route can evolve continuously. The user's objective and hard constraints do not silently change.

## Project knowledge

- [Consolidated knowledge base](docs/KNOWLEDGE_BASE.md)
- [Self-evolving scheduler design](docs/EVOLUTION_LOOP.md)

Future ChatGPT/Codex work should read these before changing architecture or rediscovering earlier conclusions.

## Current POC

This repository contains a zero-runtime-dependency Node 20 proof of concept so the orchestration loop can be tested immediately. The architecture is deliberately provider-independent and can later be migrated behind the fuller persistent production design.

## Run

```bash
npm start
```

Open `http://localhost:3000`.

At least one supported provider API credential must be supplied through the runtime environment for real AI runs. Secrets must not be committed to the repository.

## Principles

1. Simple UI; orchestration complexity stays in the backend.
2. Tasks request capabilities, not vendor names.
3. Provider failure should degrade gracefully through compatible fallbacks.
4. Usage and estimated cost must be visible.
5. Recurring tasks retain prior outputs and structured knowledge.
6. Deterministic scheduling/retry logic belongs to code, not an LLM.
7. Every run should create evidence that can improve the next run.
8. Failed/rejected paths should be remembered so the scheduler does not repeatedly rediscover them.
9. Self-evolution changes the path, not the user's goal.

## Next production milestones

- Persistent storage (PostgreSQL)
- Knowledge events + knowledge snapshots
- Future-path/strategy persistence
- Durable scheduling / restart recovery
- Versioned task definitions
- Authentication and encrypted credential references
- Structured planner schema and validation
- Provider health/cooldown and quota policies
- Search/HTTP/email/notification connectors
- Full run-step audit timeline
- Context retrieval/summarization rather than raw unlimited history
