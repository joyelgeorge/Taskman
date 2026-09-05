# Git UI + real Neon DB

The browser cannot talk to Neon. Git hosts the UI. `packages/api` talks to Neon. They must share a public origin or the UI must Connect to the API URL.

## The working shape

```
GitHub  →  Render service taskman-api
              start: node packages/api/server.js
              DATABASE_URL = your Neon connection string
              CORS_ORIGIN = https://taskman-operator.web.app
              → serves / (operator UI) and /api/* (ledger, crons, drones)
```

`taskman.onrender.com` and `taskman-api.onrender.com` were 404 on 2026-09-05. The UI on Firebase is live; the API process is not.

## Do this on Render (required)

1. Open https://dashboard.render.com → service **taskman-api** (or New → Web Service from `joyelgeorge/Taskman`).
2. Branch: `feat/settlement-ledger-autonomous-system` (or `main` after merge).
3. Build: `npm install --omit=dev`
4. Start: `node packages/api/server.js`
5. Env:
   - `DATABASE_URL` = Neon URI already used locally (same project).
   - `CORS_ORIGIN` = `https://taskman-operator.web.app` or `*`
6. Manual Deploy → Deploy latest commit.
7. Wait until `https://<service>.onrender.com/api/health` returns JSON.

## Point the UI at it

On https://taskman-operator.web.app

Connect box: `https://<service>.onrender.com`

Same-origin option: open `https://<service>.onrender.com/` — that process now serves `public/` as well, so Connect can be left as that same URL.

## Local (same Neon)

```bash
set -a; source .env; set +a
npm run api          # :3100  UI + API against Neon if DATABASE_URL is Neon
```

Open http://127.0.0.1:3100 — Connect `http://127.0.0.1:3100`.
