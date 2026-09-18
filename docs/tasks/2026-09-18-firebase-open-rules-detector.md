---
status: open
priority: P1
level: 4
opened: 2026-09-18
---

# Firebase Firestore/Realtime DB open-rules detector

Raised from an `/expanding-the-search` pass, 2026-09-18 (vertical axis: same
mistake class — missing/permissive database rules — on a stack the existing
detectors don't touch). Checked directly: zero mentions of "firebase" anywhere
in `src/codebase-audit.js`.

## Why P1, not P2 like the other detector tasks opened today

CLAUDE.md's own critical finding names the target market as **"Lovable /
Cursor / Bolt / v0 / Replit on Supabase/**Firebase**"** — Firebase is already
explicitly in scope, not a speculative widening. Every detector built so far
(`findMissingRls`, `findSupabaseTableMissingRls`, `findExposedSecret`'s
service-role pattern) only covers half of the named market. This isn't a new
bet; it's closing a gap in the bet already made.

## The five-perspective check, done before proposing this as viable

- **Adversarial:** `allow read, write: if true` (or no rules file at all,
  which some SDK defaults leave open) lets any anonymous client read/write
  the entire database — the direct Firebase analog to missing Supabase RLS.
- **Defensive — the miss this exists to prevent:** a repo with no
  `firestore.rules` / `database.rules.json` committed does **not** prove the
  database is open. Rules are commonly set by hand in the Firebase console
  and never committed. Static repo analysis alone would false-positive here
  exactly the way `findUnauthenticatedAdminRoutes` did on
  `Chalmers007/ordering-platform` (six delegated-guard routes, zero of which
  were actually unauthenticated).
- **Symbolic refuter, not a confidence score:** the same technique
  `findMissingRls`'s `confirm` field already uses for Supabase — hit the live
  REST endpoint (`https://firestore.googleapis.com/v1/projects/<id>/databases/(default)/documents/<collection>`,
  or the Realtime DB's `<project>.firebaseio.com/<path>.json`) with no
  credentials. Rows come back or they don't. That is a fact, not an
  inference from source, and it's what any finding here must be confirmed
  against before it goes anywhere near a disclosure.
- **Temporal:** unlike Supabase, Firebase does not auto-revoke on a
  leaked-key pattern — an open-rules finding stays valid longer, not
  shorter, which is a point in favor relative to the existing wedge.
- **Economic:** reuse the existing live-site/git-activity reality gate
  unchanged — no new logic needed here.

## Scope

`findFirebaseOpenRules(file, text)` in `src/codebase-audit.js`, matching the
existing `find*` shape:
1. Flag `firestore.rules` / `database.rules.json` files containing
   `allow read, write: if true;` (Firestore) or `".read": true, ".write": true`
   (Realtime DB) at the top level.
2. Flag a repo that calls `firebase.firestore()` / `getFirestore()` /
   `firebase.database()` with **no** rules file present at all — the SDK's own
   default-open behavior on a fresh project.
3. Do not flag a repo with a committed rules file that has real conditions
   (`request.auth != null`, `auth != null`) even if imperfect — that is a
   different, lower-severity finding than fully open, and conflating them is
   how a report loses credibility with a technical buyer.

## Done looks like

Function exists, tested against a synthetic fully-open rules file (fires), a
synthetic properly-guarded one (doesn't fire), and a repo using Firestore with
no rules file committed (fires, with `evidence` naming the absence rather than
a specific line). Wired into the same scan path as the Supabase detectors.
