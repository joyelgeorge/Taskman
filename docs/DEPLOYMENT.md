# Deployment Guide

## Overview

Taskman is deployed as an always-on HTTPS service on [Render](https://render.com).  
The live base URL is set as `TASKMAN_BASE_URL` and exposed at `/api/status`.

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

`DATABASE_URL`, `PORT`, and `TASKMAN_BASE_URL` are injected automatically from the managed database and service properties.

### 3. Deploy

Render auto-deploys on every push to `main`.  
To trigger a manual deploy: **Dashboard → taskman → Manual Deploy → Deploy latest commit**.

---

## Environment variables reference

| Variable | Source | Required | Description |
|---|---|---|---|
| `PORT` | Render (injected) | Yes | HTTP port — server binds to this |
| `DATABASE_URL` | Render managed DB | Yes (prod) | PostgreSQL connection string |
| `TASKMAN_BASE_URL` | Render (injected) | Yes | Public HTTPS URL e.g. `https://taskman.onrender.com` |
| `TASKMAN_API_KEY` | Render dashboard | Yes (after #13) | Service-to-service auth token |
| `TASKMAN_INTERNAL_SCHEDULER_ENABLED` | Render dashboard | Optional | Set `true` to enable durable cron scheduler |
| `NODE_ENV` | `render.yaml` | Yes | Set to `production` |
| `OPENAI_API_KEY` | Render dashboard | Optional | AI reasoning provider |
| `MOLTJOBS_API_KEY` | Render dashboard | Optional | MoltJobs income rail |

---

## Build & start

```bash
# Build (Render runs this before starting the service)
npm install --omit=dev && node scripts/migrate.js

# Start
npm start
# → node src/server.js
# → binds to process.env.PORT (default 3000 locally)
```

Migrations run automatically on every deploy via `scripts/migrate.js`.  
The server applies `db/migrations/*.sql` in order and skips already-applied files.

---

## Health checks

Render pings `/api/status` every 30 seconds.  
The endpoint returns HTTP 200 and a JSON body:

```bash
curl https://<TASKMAN_BASE_URL>/api/status
# → { "status": "ok", "db": { "enabled": true, "ok": true }, ... }
```

If the health check fails three times, Render restarts the service automatically.

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
| `GET /api/status` | Health check — DB state, scheduler status |
| `GET /api/revenue/status` | Scheduler + revenue pipeline status |
| `POST /api/revenue/scan` | Trigger discovery scan |
| `GET /api/scheduler/jobs` | List scheduled jobs |
| `POST /api/scheduler/jobs/:name/trigger` | Manually trigger a scheduled worker |

---

## Security notes

- No secret is committed to the repository.
- `render.yaml` uses `sync: false` for all secret variables.
- `/api/status` is public (needed for health checks).
- Mutation endpoints will be protected by `TASKMAN_API_KEY` once issue #13 is complete.
- `DATABASE_URL` is injected only into the Render service runtime — not exposed in logs or status output.
