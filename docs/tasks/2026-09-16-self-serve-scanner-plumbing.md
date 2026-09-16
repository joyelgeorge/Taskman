---
status: blocked
priority: P1
level: 1
opened: 2026-09-16
---

# Ship the self-serve scanner: endpoint, checkout, launch

**Endpoint + frontend BUILT 2026-09-16.** Remaining is operator-only: deploy the
server (Render), set PayPal credentials, wire the page's two config constants,
deploy hosting, and launch once. See `packages/web/scan-server/DEPLOY.md`.

The value is built and runnable: `npm run self-serve -- --url <app> [--paid]`
scans a deployed app and produces the free report (counts) or the paid report
(exact fixes). `packages/core/self-serve/report.js` is the core; the fixes are
correct and mutation-tested. This is the pull lane — a dollar can arrive with no
message sent.

## What remains — plumbing and one launch

1. **Public scan endpoint.** ✅ BUILT — `packages/web/scan-server/` is a tiny Node
   service (POST /scan → freeReport + scanId; GET /report → paidReport after a
   PayPal-verified payment). Deployable to Render free tier; `render.yaml` +
   `DEPLOY.md` included. Paywall fails closed.
2. **Frontend.** ✅ BUILT — `packages/web/public/audit/scan.html` ships in the
   audit-site build: paste URL → counts → PayPal button → fixes. Set two config
   constants (server URL + PayPal client id) after deploy.
3. **Self-serve checkout.** A Stripe Payment Link / Gumroad / Lemon Squeezy link.
   On success, serve `paidReport` for that scan (store scans in Neon keyed by an
   id; unlock by the checkout reference). **No invoice email** — that reintroduces
   the labour this lane exists to remove.
4. **Record settlements** via `close-to-settlement`, keyed on the checkout's real
   transaction id. The rail is the payment provider, not `manual_receipt`.
5. **One launch.** Show HN / r/Supabase / r/vibecoding / the Lovable-Bolt-v0
   Discords / a Product Hunt listing. Once. Then SEO and word of mouth.

## Why the operator, not the agent

Steps 1–2 are buildable by a session; 3–5 need the operator's Stripe/Gumroad
account, the Firebase deploy, and the launch post. The agent cannot create the
payment account or make the public post — same line as all outreach.

## Pricing

$5–29 one-time per report is the proven self-serve band (HN researcher sells fix
reports at $5; scanners subscribe $5–29/mo). Start at the low end to remove
friction; the fix is worth far more than the price (see the cost-study reasoning
in `price-and-deliver-the-fix`).

## Done looks like

A stranger pastes their URL, sees real counts, clicks pay, and gets the fixes —
and a settlement row appears — without anyone sending a message.
