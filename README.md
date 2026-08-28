# Taskman

Taskman is a lightweight API-only task scheduler and orchestration app.

## What it does

- Accepts plain-language tasks.
- Runs tasks manually or on a recurring interval.
- Routes AI work across interchangeable API providers.
- Falls back when a provider fails.
- Keeps task history and execution context.
- Tracks provider, token usage, estimated cost, and run status.
- Produces a concise next-best-action after each run.
- Uses external APIs only; no local AI model is required.

## Current POC

This repository contains a zero-runtime-dependency Node 20 proof of concept so the orchestration loop can be tested immediately. The architecture is deliberately provider-independent and can later be migrated behind the fuller Spring Boot/PostgreSQL/Quartz production design.

## Run

```bash
cp .env.example .env
npm start
```

Open `http://localhost:3000`.

At least one provider API key is needed for real AI runs. Without keys, the UI and scheduler still run and provider readiness is visible.

## Provider environment variables

- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `HF_TOKEN`
- Custom OpenAI-compatible provider: `CUSTOM_API_KEY`, `CUSTOM_BASE_URL`, `CUSTOM_MODEL`

## Principles

1. Simple UI; orchestration complexity stays in the backend.
2. Tasks request capabilities, not vendor names.
3. Provider failure should degrade gracefully through compatible fallbacks.
4. Usage and estimated cost must be visible.
5. Recurring tasks retain prior outputs as context.
6. Deterministic scheduling/retry logic belongs to code, not an LLM.

## Next production milestones

- Persistent storage (PostgreSQL)
- Durable Quartz-style scheduling / restart recovery
- Authentication and encrypted credential references
- Structured planner schema and validation
- Provider health/cooldown and quota policies
- Search/HTTP/email/notification connectors
- Full run-step audit timeline
