# Taskman

Taskman is a private, lightweight orchestration system designed to turn **data + deterministic algorithms + external AI intelligence + execution interfaces** into repeatable money-producing workflows.

## Top-level goal

The goal is not to build another AI model. The AI already exists.

Taskman should continuously use the best available external intelligence through APIs and combine it with accumulated project/task data, deterministic scoring, memory, scheduling, and execution tools.

The system should:

```text
collect relevant data
→ structure and score it with algorithms
→ identify the most valuable unresolved money-producing gap
→ send only the relevant context to the best available AI/tool
→ receive the missing piece
→ validate and merge it into knowledge
→ determine the next gap
→ execute when the path becomes actionable
→ observe the economic result
→ learn from it
→ repeat without redoing one-time setup
```

The intended end state is a **private money-making intelligence system** that increasingly identifies and fulfills doable AI-assisted tasks with minimal repeated human setup.

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
- Uses relevance-first context rather than sending the entire accumulated knowledge base into every AI call.
- Prioritizes paths that can lead to an observable economic event.

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
- [Future domino model](docs/FUTURE_DOMINO_MODEL.md)
- [Money-task core](docs/MONEY_TASK_CORE.md)
- [Brain architecture](docs/BRAIN_ARCHITECTURE.md)
- [Deployment guide](docs/DEPLOYMENT.md)

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

1. Do not build a new AI model; use the strongest suitable current model/tool through an interface.
2. Simple UI; orchestration complexity stays in the backend.
3. Tasks request capabilities, not vendor names.
4. Provider failure should degrade gracefully through compatible fallbacks.
5. Usage and estimated cost must be visible.
6. Recurring tasks retain prior outputs and structured knowledge.
7. Deterministic scheduling, scoring, retry and policy logic belongs to code, not an LLM.
8. Every run should create evidence that can improve the next run.
9. Failed/rejected paths should be remembered so the scheduler does not repeatedly rediscover them.
10. Self-evolution changes the path, not the user's goal.
11. AI calls receive the smallest relevant context needed for the current gap.
12. One-time setup should be reused; repeated human configuration is a system failure to minimize.
13. The final optimization target is not information volume; it is validated progress toward repeatable economic outcomes.

## Next production milestones

- Persistent storage (PostgreSQL)
- Knowledge events + knowledge snapshots
- Money-opportunity / gap / strategy data model
- Deterministic scoring and prioritization pipeline
- Future-path/strategy persistence
- Durable scheduling / restart recovery
- Versioned task definitions
- Authentication and encrypted credential references
- Structured planner schema and validation
- Provider health/cooldown and quota policies
- Search/HTTP/email/notification connectors
- Full run-step audit timeline
- Context retrieval/summarization rather than raw unlimited history
- Economic outcome and attribution tracking
