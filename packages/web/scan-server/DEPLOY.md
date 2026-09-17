# Deploy the self-serve scanner

Two pieces: the scan **server** (a tiny Node service) and the static **page**
already in the audit site. ~15 min, free except PayPal's per-sale fee.

## 1. Deploy the scan server (Render free tier, like Jez)

1. render.com → New → Web Service → connect this repo.
2. It reads `packages/web/scan-server/render.yaml`. Set these env vars:
   - `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` — from your PayPal developer dashboard
     (REST app credentials for the account behind paypal.me/joyelgt).
   - `ALLOW_ORIGIN` — your hosting origin, e.g. `https://taskman-operator.web.app`.
   - `REPORT_PRICE_USD` — the unlock price (default 5).
3. Deploy. `/health` should return `{"ok":true}`.

**The paywall fails closed:** with no PayPal credentials the server refuses every
unlock, so a misconfigured deploy never gives the report away.

## 2. Wire the page to the server

In `packages/web/public/audit/scan.html`, set the two config constants near the
top of the script (or define `window.SCAN_ENDPOINT` / `window.PAYPAL_CLIENT_ID`
before it runs):

- `SCAN_ENDPOINT` — your Render URL, e.g. `https://vibe-scan-xxx.onrender.com`
- `PAYPAL_CLIENT_ID` — the same PayPal client id (public; safe in the page)

Then `npm run build:audit-site && firebase deploy --only hosting`. The scanner is
live at `/scan.html`.

## 3. Confirm the loop, then record the sale

Paste a URL → see counts → pay $5 in PayPal → the report unlocks with the fixes.
When a sale lands, record it with `close-to-settlement`, rail `paypal`, keyed on
the PayPal order id (the server verified it COMPLETED before unlocking).

## 4. Launch once

Post the link where the pain is: r/Supabase, r/vibecoding, the Lovable / Bolt /
v0 Discords, a Show HN. Once — then SEO and word of mouth. This is the pull lane:
after the launch it runs without anyone sending a message.
