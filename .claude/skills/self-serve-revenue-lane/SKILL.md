---
name: self-serve-revenue-lane
description: Use when outreach is the bottleneck, when the question is how to earn without contacting customers one by one, when a lane needs money to arrive while nobody is sending anything, and whenever turning existing detection or analysis capability into a product people buy themselves.
---

# Self-serve revenue lane — pull, not push

## Overview

Outreach makes every dollar cost a unit of the operator's labour: find a lead,
send an email, wait. That is a job, not a business, and it is the trap this
project keeps falling into.

The escape is a **self-serve product**: the customer comes to it, runs it on
their own thing, sees a real problem, and pays to fix it — with no message sent
by anyone. You build it once and launch it once; then it runs.

**The test this lane must pass:** *if the operator does nothing for a week, can a
dollar still arrive?* Push lanes answer no. Pull lanes answer yes.

## The shape that works: freemium, fix-gated

| Tier | What the visitor gets | Why it converts |
|---|---|---|
| **Free** | Paste your URL → **counts** of real problems ("3 exposed keys, 12 tables unprotected") | The count is true and alarming; the detail is the product |
| **Paid** | The **exact fixes** — the RLS SQL, the rotation steps, the CORS config, a before/after re-scan | They came with the problem; you sell the cure, self-checkout |

The free scan is the marketing and it is honest. The paid unlock is the fix, not
the scan — the scan-only niche is crowded and free (see CLAUDE.md). **Sell the
cure.**

## Why this fits the existing infra

Nothing new is needed to detect or host:

- **Detectors** (`src/codebase-audit.js`) — the scan engine.
- **Bundle scanner** (`packages/core/jobs/bundle-scan.js`) — paste-a-URL, no repo
  needed, reads only what a browser downloads.
- **Firebase audit site** (`packages/web/public/audit`) — the public frontend.
- **Neon** — store each scan so the paid unlock can be re-served.

What is genuinely new and worth building: **fix generation** — turning each
finding into the exact remediation. That is the paid artefact and the moat.

## Distribution is a one-time act, not a per-customer one

Self-serve still needs the URL in front of people — but ONCE:

- A launch post to the communities that already have the pain: r/Supabase,
  r/vibecoding, the Lovable/Bolt/v0 Discords, a Show HN, a Product Hunt listing.
- SEO on the exact query ("is my supabase app secure", "lovable app exposed key").
- A free GitHub Action / marketplace listing developers add themselves.

The operator does this once. It is not the per-lead email that made every dollar
cost an hour.

## The payment rail must be self-serve too

A self-serve product cannot end in an invoice the operator emails — that
reintroduces the labour. Use a **payment link the visitor clicks themselves**:
Stripe Payment Link, Gumroad, Lemon Squeezy. Money lands with no message sent.
The `close-to-settlement` skill still records it, keyed on the checkout's real
transaction id.

## Build order (thin slice first)

1. **Fix generator** — finding → exact remediation text. Pure, testable, the moat.
2. **Free report** — scan result → counts only, no detail. The honest teaser.
3. **Paid report** — the full report with fixes, served only after payment.
4. **A public scan endpoint** on the Firebase site calling the bundle scanner.
5. **A self-serve checkout link** gating the paid report.
6. **One launch.** Then watch, do not chase.

Ship 1–3 first: they are pure functions, fully testable now, and they are the
product's value. The plumbing (4–6) is deploy and an operator's accounts.

## What stays true from the push lanes

- **Never contact anyone.** A self-serve product contacts nobody by definition —
  that is the point. No auto-emailing scan results to owners.
- **Read-only.** Scan only what the visitor's own public URL serves.
- **anon vs service_role.** An anon key in a bundle is safe; only `service_role`
  is a finding. A product that flags anon keys is a false-positive machine that
  burns trust at scale — far worse in self-serve than in one disclosure.
- **Record only real money** (`close-to-settlement`), keyed on the checkout id.

## Common mistakes

| Mistake | Cost |
|---|---|
| Charging for the scan | Competing with free; the fix is the product |
| An invoice email at the end | Reintroduces the per-dollar labour you left |
| Flagging anon keys to look impressive | A false-positive machine at scale; trust gone |
| Building all six steps before launching | 1–3 are the value; ship and launch thin |
| Chasing traffic like leads | Distribution is one launch, then SEO/word-of-mouth |
