# Host the operator UI

The complete operator console now lives in `public/` and is served by:

- `npm start` → `src/server.js` → http://127.0.0.1:3000
- Render service `taskman` (same files)
- Firebase Hosting (`firebase.json` → `public/`)

## Local

```bash
set -a; source .env; set +a
npm start
```

Open http://127.0.0.1:3000

Connect:
- same origin (`http://127.0.0.1:3000`) for brain/tasks/runs/status
- `http://127.0.0.1:3100` (`npm run api`) for ledger/crons/drones/orders

## Firebase `*.web.app`

```bash
git pull
npm install -g firebase-tools
firebase login
firebase projects:create taskman-operator --display-name "Taskman operator"
firebase deploy --only hosting
```

On the hosted page, Connect must be a **public HTTPS API** (Render `taskman-api` or `taskman`). `127.0.0.1` will not work from web.app.
