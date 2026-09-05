# Taskman operator UI

Vanilla HTML/CSS/JS. No build step. Served by `npm run web` on `:3200`.

```bash
set -a; source .env; set +a
npm run api    # :3100  ledger, crons, drones, orders
npm run web    # :3200  this UI
```

Open http://127.0.0.1:3200  
Connect box: `http://127.0.0.1:3100`

Screens (`#overview` … `#growth`) are hash routes. Data comes only from live `packages/api` routes. Revenue stays $0 until a settlement is `CLEARED`.
