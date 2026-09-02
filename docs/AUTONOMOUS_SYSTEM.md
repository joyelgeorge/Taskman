# Taskman Autonomous System

_Built 2026-09-02. Implements the collection and observability half of `TARGET_DESIGN.md`._

## What it does

Drones fly to the internet on a schedule and bring back signals. Signals are scored
against deterministic rules and the survivors become candidates for the money
pipeline. Six crons run the whole thing, one of which watches the other five, and
another of which reads the system's own evidence and files improvement proposals.

```text
  internet
     │  drones: http_json · rss · page_watch          ← the only outbound reach
     ▼
  signals ──── dedupe on (drone, fingerprint) ──── injection scan → QUARANTINED
     │
     ▼  deterministic rules from the drone's own config. No model.
  candidate_queue ──▶ existing discover/validate/execute ──▶ rails
                                                              │
                                                              ▼
                                            settlements (processor-verified)
                                                              │
                                                              ▼
                                            governor: probation → proven → disabled
```

## Components

Each is separately deployable and shares nothing but the database.

| Component | Path | Runs on | Notes |
|---|---|---|---|
| **db** | `packages/db` | Neon | Schema, migrations, pool. Migrations span `db/migrations` and `packages/db/migrations`. |
| **core** | `packages/core` | library | Drones, signals, health, alerts, improvements, ledger bridge. |
| **api** | `packages/api` | Render free | JSON API. Sleeps when idle — nothing depends on it being awake. |
| **web** | `packages/web` | Vercel | Static dashboard. Holds no data; reads the API cross-origin. |
| **crons** | `packages/crons` | GitHub Actions | Six jobs, each its own workflow with its own history. |

## The six crons

| Cron | Schedule | Watchdog tolerance | Does |
|---|---|---|---|
| `drone-dispatch` | `*/15 * * * *` | 1h | Flies every due drone, ingests signals, seeds the fleet on an empty install |
| `signal-process` | `*/20 * * * *` | 90m | Scores new signals, promotes survivors into `candidate_queue` |
| `health-check` | `*/30 * * * *` | 2h | Checks db, deployed services, drones and crons; opens and resolves alerts |
| `cron-monitor` | `0 * * * *` | 3h | The watchdog over the other five |
| `revenue-check` | `0 */6 * * *` | 9h | Syncs settlements from Stripe, enforces rail viability |
| `improve` | `0 3 * * *` | 30h | Researches the system's own evidence, files proposals |

Tolerances are far wider than the schedules because free schedulers are not
punctual — GitHub Actions commonly runs tens of minutes late. A watchdog that
fires on ordinary lateness gets muted, which is worse than no watchdog.

### Who watches the watchdog

`cron-monitor` cannot report its own death. Two independent things cover it:
`health-check` emits a `cron:cron-monitor` component check, and `GET /api/health`
returns **503** whenever any cron is unhealthy, so an external uptime monitor
(UptimeRobot, Better Stack, a Cloudflare Worker) polling that one URL catches the
case where everything inside has stopped.

## Why the crons never call the API

Free web services sleep. If crons ran by hitting HTTP endpoints, a sleeping API
would silently stop the autonomous system and nothing would report an error —
exactly the failure mode this design exists to prevent. Crons hold their own
database connection and their own outbound reach.

## Idempotency

Each cron run computes a slot key from its schedule (`900s@2026-09-02T10:15:00Z`)
and inserts it under a unique index. Two runners firing the same slot collapse to
one execution, so the hosted scheduler and a local `npm run scheduler` can point at
the same database safely.

## Untrusted content

Drone output is written by strangers. Signals are scanned for agent-directed text
— "ignore previous instructions", prompt exfiltration, piped shell commands — and
anything matching is stored as `QUARANTINED`: visible for inspection, never
claimable for processing. It is rejected rather than sanitized, because sanitizing
invites a bypass. Promoted candidates carry `untrustedContent: true`.

## Running it

```bash
cp .env.example .env          # DATABASE_URL is the only required value
npm install
npm run migrate               # applies all 9 migrations
npm run smoke                 # runs the whole chain once, hits the real internet
```

Then, in separate terminals:

```bash
npm run api                   # :3100
npm run web                   # :3200  — enter the API URL in the header
npm run scheduler             # all six crons in-process
```

A single cron: `npm run cron -- drone-dispatch` (add `--force` to ignore the slot).

Without `DATABASE_URL` everything runs in memory: useful for `npm test` and
`npm run smoke`, but nothing survives the process.

## Deploying free

1. **Neon** — create a project, copy the connection string.
2. **GitHub** — add `DATABASE_URL` (and optionally `STRIPE_API_KEY`) as repository
   secrets; add `API_HEALTH_URL` / `WEB_HEALTH_URL` as repository variables. The six
   workflows in `.github/workflows/` start on their own schedules.
3. **Render** — deploy from `render.yaml`; it defines `taskman-api`. Set
   `CORS_ORIGIN` to the UI's origin and `TASKMAN_API_TOKEN` to any random string.
4. **Vercel** — deploy `packages/web` (its `vercel.json` sets `public` as the output
   directory). No build step.

Vercel is deliberately not the cron host: its Hobby plan allows **two** cron jobs
running **once per day**, which cannot express this schedule at all.

## Adding a drone

```bash
curl -X POST $API/api/drones -H 'content-type: application/json' \
  -H "authorization: Bearer $TASKMAN_API_TOKEN" -d '{
    "id": "my-source",
    "kind": "http_json",
    "name": "My source",
    "targetUrl": "https://api.example.com/items",
    "intervalSeconds": 900,
    "config": {
      "itemsPath": "data.items", "idField": "id", "titleField": "name", "urlField": "url",
      "rules": { "include": ["hiring"], "exclude": ["draft"], "threshold": 0.4, "staleAfterHours": 24 }
    }
  }'
```

`kind` is one of `http_json`, `rss`, `page_watch`. Registration upserts on `id`.

The default fleet points at Hacker News. Those are working examples, not a
business: they prove the pipeline is live on a fresh install. The sources that
matter are the ones only you can reach.

## Failure policy

- A drone that fails 5 times consecutively is **quarantined** with exponential
  backoff (15m doubling to a 6h cap), not disabled. A dead endpoint and a briefly
  unreachable one look identical from here, and only one should need a human.
- A cron that throws is recorded `FAILED` with its stack; the run row is opened
  *before* the handler runs, so a crash is still visible.
- An alert is idempotent on `(kind, component)` and auto-resolves when the
  component returns to OK, so the open-alert list describes now rather than history.
- A rail that spends its $50 probation budget with zero verified settlements is
  disabled automatically and can only be re-enabled by hand.

## What it does not do

`improve` files proposals; it does not apply them. Every proposal is an inert
`PROPOSED` row that a human moves to `ACCEPTED`. A system that rewrites itself on
its own evidence is the failure this repository already has one example of — see
`SYSTEM_DESIGN.md` §9.
