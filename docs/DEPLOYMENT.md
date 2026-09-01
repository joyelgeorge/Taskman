# Deployment Guide

## Overview

Taskman is deployed as an always-on HTTPS service on [Render](https://render.com).  
The live base URL is set as `TASKMAN_BASE_URL`. Process liveness, traffic readiness, and diagnostics use separate endpoints.

Taskman validates its runtime configuration before migrations or the web server
start. Run `npm run preflight` with the target environment. The command performs
no database, provider, rail, payment, or network action and prints only a
redacted configuration summary and fingerprint.

---

## Quick start (Render)

### 1. Connect the repository

1. Log in to [render.com](https://render.com) and click **New → Blueprint**.
2. Connect `joyelgeorge/Taskman` (the repo is private — grant Render read access).
3. Render detects `render.yaml` and creates:
   - **taskman** — Node.js web service
   - **taskman-db** — managed PostgreSQL database

### 2. Set secret environment variables

In the Render dashboard → **taskman → Environment**, add:

| Variable | Description |
|---|---|
| `TASKMAN_API_KEY` | Service-to-service auth key (generate with `openssl rand -hex 32`) |
| `OPENAI_API_KEY` | AI provider key |
| `MOLTJOBS_API_KEY` | MoltJobs income rail key (optional) |

> **Never commit secret values.** `render.yaml` marks these `sync: false` so Render will not overwrite them.

`DATABASE_URL` and `PORT` are injected automatically. Set `TASKMAN_BASE_URL`
to the service's complete public HTTPS URL; production preflight rejects a
missing, malformed, or non-HTTPS value.

### 3. Deploy

Render auto-deploys on every push to `main`.  
To trigger a manual deploy: **Dashboard → taskman → Manual Deploy → Deploy latest commit**.

---

## Environment variables reference

| Variable | Source | Required | Description |
|---|---|---|---|
| `PORT` | Render (injected) | Yes | HTTP port — server binds to this |
| `DATABASE_URL` | Render managed DB | Yes (prod) | PostgreSQL connection string |
| `TASKMAN_BASE_URL` | Render dashboard | Yes (prod) | Complete public HTTPS URL, e.g. `https://taskman.onrender.com` |
| `TASKMAN_ROLE` | Process command | No | `web`, `worker`, `migration`, or `preflight`; default `web` |
| `TASKMAN_AUTH_MODE` | `render.yaml` | Yes (prod) | `api-key` or a controlled `external` boundary; `disabled` is rejected in production |
| `TASKMAN_TENANT_MODE` | `render.yaml` | Yes (prod) | Explicitly `single-tenant` or `multi-tenant` |
| `TASKMAN_API_KEY` | Render dashboard | With `api-key` mode | Service-to-service auth token |
| `PGSSL` | Environment | No | `prefer` (default), `require`, or `disable` |
| `PGPOOL_MAX` | Environment | No | Integer 1–100; default 5 |
| `TASKMAN_INTERNAL_SCHEDULER_ENABLED` | Render dashboard | No | Strict boolean; default `false` |
| `TASKMAN_BRAIN_INTERVAL_MINUTES` | Environment | No | Integer 0–10080; 0 disables the timer |
| `TASKMAN_REASONING_ENABLED` | Environment | No | Strict boolean; default `true` |
| `TASKMAN_ALLOW_WRITE_RAILS` | Environment | No | Strict boolean; defaults to fail-closed `false` |
| `TASKMAN_WRITE_RAILS` | Environment | When writes enabled | Comma-separated explicit rail allowlist |
| `TASKMAN_TRUST_PROXY` | Render dashboard | Optional | Set `true` only behind a trusted proxy that overwrites `X-Forwarded-Proto`; enables HTTPS detection for HSTS |
| `TASKMAN_CSP_REPORT_ONLY` | Render dashboard | Optional | Set `true` to stage CSP without enforcement; unset for strict enforcement |
| `TASKMAN_HSTS_ENABLED` | Render dashboard | Optional | Defaults on for trusted production HTTPS; set `false` for an emergency rollback |
| `TASKMAN_MAX_JSON_BODY_BYTES` | Config | Optional | Maximum JSON request body; default 1 MiB |
| `TASKMAN_PROVIDER_TIMEOUT_MS` | Config | Optional | Per-provider attempt deadline; default 45s |
| `TASKMAN_RUN_TIMEOUT_MS` | Config | Optional | Overall task execution deadline; default 5m |
| `TASKMAN_HTTP_REQUEST_TIMEOUT_MS` | Config | Optional | Inbound request timeout; default 120s |
| `TASKMAN_HTTP_HEADERS_TIMEOUT_MS` | Config | Optional | Header receive timeout; default 15s |
| `TASKMAN_HTTP_KEEP_ALIVE_TIMEOUT_MS` | Config | Optional | Idle keep-alive timeout; default 5s |
| `NODE_ENV` | `render.yaml` | Yes | Set to `production` |
| `OPENAI_API_KEY` | Render dashboard | Optional | AI reasoning provider |
| `MOLTJOBS_API_KEY` | Render dashboard | Optional | MoltJobs income rail |

---

## Build & start

Taskman supports Node.js 24 only. `.node-version` is the single pinned runtime version used by local version managers and GitHub Actions; Render also discovers this file for its Node runtime. `package.json` rejects unsupported Node major versions.

```bash
# Validate without external effects, then migrate
TASKMAN_ROLE=migration npm run preflight
TASKMAN_ROLE=migration node scripts/migrate.js

# Start
npm start
# → node src/server.js
# → binds to the validated port (default 3000 locally)
```

Migrations run automatically on every deploy via `scripts/migrate.js`.  
The server applies `db/migrations/*.sql` in order and skips already-applied files.

---

## Health checks

Render pings `/health/ready`. The probes have separate contracts:

- `GET /health/live` is a lightweight process probe. It does not query optional dependencies.
- `GET /health/ready` returns HTTP 503 when production requirements are unavailable.
- `GET /api/status` always returns diagnostics with a top-level `healthy`, `degraded`, or `unready` state and safe Node runtime metadata.

Production always requires PostgreSQL; memory persistence is rejected before the
server binds. Local development without PostgreSQL remains ready but is labeled
`degraded`, `memory`, and non-durable. Set `TASKMAN_REQUIRE_PROVIDER=true` only
when at least one configured AI provider is a traffic-readiness requirement.
Enabling the internal scheduler also requires durable scheduler storage.

Health responses expose component states and provider identifiers only; they do not expose credentials, connection strings, or credential metadata.

```bash
curl https://<TASKMAN_BASE_URL>/health/live
curl https://<TASKMAN_BASE_URL>/health/ready
curl https://<TASKMAN_BASE_URL>/api/status
```

If the readiness check fails repeatedly, Render removes or restarts the service according to the platform health policy.

---

## Logs

```bash
# Via Render dashboard
Dashboard → taskman → Logs

# Via Render CLI
render logs --service taskman --tail
```

---

## Rollback

1. **Render dashboard** → **taskman → Deploys** → select a previous deploy → **Rollback**.
2. Or push a revert commit to `main` — autoDeploy triggers a fresh build.

---

## Local development

```bash
# Copy the example env file
cp .env.example .env
# Edit .env with your local values

# Start with hot-reload
npm run dev

# Run migrations against local PostgreSQL
DATABASE_URL=postgresql://localhost:5432/taskman node scripts/migrate.js

# Run tests
node --test                                              # memory mode
DATABASE_URL=postgresql://localhost:5432/taskman node --test  # PostgreSQL mode
```

---

## Key endpoints

| Endpoint | Description |
|---|---|
| `GET /health/live` | Lightweight process liveness |
| `GET /health/ready` | Traffic readiness with environment-aware dependency policy |
| `GET /api/status` | Detailed DB, provider, scheduler, durability, and usage diagnostics |
| `GET /api/revenue/status` | Scheduler + revenue pipeline status |
| `POST /api/revenue/scan` | Trigger discovery scan |
| `GET /api/scheduler/jobs` | List scheduled jobs |
| `POST /api/scheduler/jobs/:name/trigger` | Manually trigger a scheduled worker |

---

## Request and execution limits

All JSON routes use one byte-counted reader and return HTTP 413 before buffering beyond the configured body limit. Provider attempts receive an abort signal and a bounded share of the overall run deadline. Timeout records use stable codes such as `PROVIDER_TIMEOUT` and `RUN_DEADLINE_EXCEEDED`, plus provider ID and duration only. Increasing a limit requires a finite positive value within the hard safety bounds enforced by `src/limits.js`.

## Security notes

- No secret is committed to the repository.
- `render.yaml` uses `sync: false` for all secret variables.
- `/api/status` is public (needed for health checks).
- Mutation endpoints will be protected by `TASKMAN_API_KEY` once issue #13 is complete.
- `DATABASE_URL` is injected only into the Render service runtime — not exposed in logs or status output.
- Browser-facing responses, API responses, errors, and 404s receive the same centralized CSP, framing, MIME-sniffing, referrer, and permissions policy.
- HSTS is emitted only in production when HTTPS is directly observed or `TASKMAN_TRUST_PROXY=true` explicitly trusts the proxy protocol header. Do not enable proxy trust unless the edge overwrites `X-Forwarded-Proto`.
- To stage a policy change, temporarily set `TASKMAN_CSP_REPORT_ONLY=true`, validate browser reports and dashboard flows, then unset it to restore enforcement.
