# Research notes

Generated from the `research_notes` store by `npm run research -- export`.
Postgres holds the live rows; this file is what survives losing it.

## Client‑side Stripe Checkout in Vibe‑coded apps permits price tampering and can bypass webhook signature verification because the implementation relies on the publishable key and omits server‑side validation of the order amount and the webhook HMAC signature, exposing the application to manipulation of the transaction amount and replay or forgery of webhook events.

- **Tier:** REFERENCED
- **Source:** stripe:secret-vs-publishable-rule, stripe:webhook-signature-verification
- **Lane:** vibe-security
- **Recorded:** Fri Sep 18 2026 08:53:32 GMT+0530 (India Standard Time)

## AI coding assistants often generate Next.js Server Actions that perform privileged database operations (create, update, delete) without first invoking an authentication guard or checking the user's session, thereby exposing sensitive data to unauthenticated or unauthorized callers. This pattern can be automatically flagged by a regex that matches exported async server functions containing privileged calls but lacking an early auth check—e.g., `/export\s+async\s+function\s+\w+\s*\(.*\)\s*\{[^}]*?(await\s+\w+\.(create|update|delete))[^
]*\{[^}]*\}/`—or by an AST check that ensures an `if`/`requireAuth` guard appears before any `create|update|delete` call inside the function body.

- **Tier:** REFERENCED
- **Source:** nextjs:server-action-auth-absence-regex
- **Lane:** vibe-security
- **Recorded:** Thu Sep 17 2026 21:44:26 GMT+0530 (India Standard Time)

## Supabase anonymous JWTs are short‑lived, contain only public‑read permissions, and are meant for client‑side use, whereas service_role JWTs grant unrestricted database access and must never be exposed in client bundles; automated scanners distinguish false positives by flagging any JWT that contains a 'role' claim equal to 'service_role' or a long‑lived expiration, and cross‑checking the token's signature against the known service_role secret pattern, while ignoring tokens that match the anon role or have typical short expiries.

- **Tier:** REFERENCED
- **Source:** supabase:jwt-privilege-heuristic
- **Lane:** vibe-security
- **Recorded:** Thu Sep 17 2026 21:42:04 GMT+0530 (India Standard Time)

## Self-serve security scanner is LIVE: https://taskman-operator.web.app/scan.html (frontend, Firebase) backed by https://taskman2.onrender.com (scan server, Render free). Paste URL -> free counts -> PayPal $5 -> fixes unlock. Paywall verified fail-closed (402 on invalid order). First complete pull lane in production; earns with no per-customer outreach. Remaining: a real test purchase + one launch post.

- **Tier:** REFERENCED
- **Source:** Live curl verification 2026-09-16
- **Lane:** self-serve-scanner
- **Recorded:** Wed Sep 16 2026 06:08:45 GMT+0530 (India Standard Time)

## Full-capacity sweep 2026-09-15: repo surface is near-exhausted — 108 of 120 candidates already scanned, only 12 new. The one new hit (thread-and-form-store) is a self-hostable template, not a business (same-second single commit, no deployed site), correctly rejected by the business-reality gate. Confirms the repo lane is a depleting stock

- **Tier:** REFERENCED
- **Source:** npm run hunt-vibe-leads + gh metadata, 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 14:49:25 GMT+0530 (India Standard Time)

## easternLM sized from PUBLIC signals only (never their systems): established rebrand of Wesemanns, single-location yard, industry benchmark ~$700K-2M/yr revenue, house-account credit. Customer base plausibly several hundred to a few thousand — straddles NY SHIELD's 500-resident AG-notification threshold, the key cost driver

- **Tier:** REFERENCED
- **Source:** Statista/BizBuySell benchmarks + business listings, 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 14:09:53 GMT+0530 (India Standard Time)

## easternLM fix ROI: writable credit/charge endpoints are direct-fraud exposure (unbounded, realistically $5K-100K+ before detection); PII exposure triggers NY SHIELD notification duties and $120K-1.24M small-business breach-cost range. Fix is hours of work. Do not put a dollar figure in message one

- **Tier:** REFERENCED
- **Source:** IBM 2026 / Verizon DBIR 2025 / NY SHIELD Act (Insureon, Jackson Lewis), 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 14:06:43 GMT+0530 (India Standard Time)

## easternLM is a REAL operating business, not a test repo: Eastern Landscape & Mason Supply, Center Moriches NY, phone (631)874-6244, live storefront at easternlm.com serving a full product catalogue with real prices ($11-$140) and delivery. Repo is 6 months old, 3MB, committed weekly through 2026-09-09

- **Tier:** REFERENCED
- **Source:** curl of easternlm.com/shop and /contact + gh repo metadata, 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 14:04:01 GMT+0530 (India Standard Time)

## easternLM carries a CONFIRMED auth-bypass class on privileged API routes (not the earlier false-positive class). Verified real by hand. Specifics withheld from this public repo; operator has them

- **Tier:** REFERENCED
- **Source:** Hand-verification 2026-09-15; details in session, not committed
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 13:53:27 GMT+0530 (India Standard Time)

## findUnauthenticatedAdminRoutes fixed: it missed delegated guard helpers (requireSuperAdmin etc). Re-audit cleared Chalmers007 (6->0) and lms-platform (4->0) as false positives; easternLM's remained and were hand-confirmed real

- **Tier:** REFERENCED
- **Source:** src/codebase-audit.js + re-audit of 3 repos, 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 13:53:25 GMT+0530 (India Standard Time)

## The vibe-app security niche now has at least six named commercial competitors (vibeappscanner, ship-safe, guardlayer, vibe-eval, ubserve, Sherlock Forensics)

- **Tier:** REFERENCED
- **Source:** Search results 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 13:47:17 GMT+0530 (India Standard Time)

## 'Beg bounty' is a recognised despised pattern: minor publicly-observable findings plus withholding detail until payment. Our drafts give full detail free with no price, which is the distinguishing line

- **Tier:** REFERENCED
- **Source:** https://www.troyhunt.com/beg-bounties/, read 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 13:47:14 GMT+0530 (India Standard Time)

## Vibe-app security pricing spans 300x: the HN researcher sells fix reports at $5; Sherlock Forensics lists audits from $1,500

- **Tier:** REFERENCED
- **Source:** supaexplorer/HN thread and sherlockforensics.com/pages/vibe-coding-security.html, read 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 13:47:12 GMT+0530 (India Standard Time)

## A scan of 20,052 deployed indie-launch URLs found 2,217 domains (11.04%) exposing Supabase credentials in the client bundle — a far larger and higher-yield surface than public GitHub repos

- **Tier:** REFERENCED
- **Source:** https://news.ycombinator.com/item?id=46662304, read 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 13:47:09 GMT+0530 (India Standard Time)

## Supabase auto-revokes NEW-format (sb_secret_) keys pushed to public GitHub via GitHub secret scanning; legacy service_role JWTs are harder to spot and are NOT reliably revoked

- **Tier:** REFERENCED
- **Source:** https://github.blog/changelog/2022-03-28-supabase-is-now-a-github-secret-scanning-partner/ and supabase.com/blog/supabase-security-2025-retro, read 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 13:47:06 GMT+0530 (India Standard Time)

## Chalmers007/ordering-platform exposes one service_role key across 9 script files, not 9 distinct keys

- **Tier:** REFERENCED
- **Source:** Hashed each JWT occurrence without recording values, 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 13:45:02 GMT+0530 (India Standard Time)

## missing-rls is emitted once per table, so one schema dump becomes 70 criticals; Chalmers007 has 30 tables with RLS correctly enabled and 4 without

- **Tier:** REFERENCED
- **Source:** Counted enable-row-level-security statements across 45 migrations, 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 13:45:00 GMT+0530 (India Standard Time)

## command-injection findings need taint-source checks: 4 of 4 in flyrpro interpolated process.env into a local script, not request data

- **Tier:** REFERENCED
- **Source:** scripts/load-regional-data.ts:88-93, read 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 13:44:57 GMT+0530 (India Standard Time)

## findUnauthenticatedAdminRoutes had a 100% false-positive rate on Chalmers007/ordering-platform: 6 of 6 routes call requireSuperAdmin

- **Tier:** REFERENCED
- **Source:** Read all six route files from a fresh clone 2026-09-15
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 13:44:55 GMT+0530 (India Standard Time)

## The vibe-app sweep headline overstates by ~5x: 19 leads reported CRITICAL, 7 carry a compelling finding, 4 an exposed secret

- **Tier:** REFERENCED
- **Source:** Re-audited 22 leads against fresh clones 2026-09-15; docs/outreach/2026-09-15-verified-lead-queue.md
- **Lane:** vibe-app-security
- **Recorded:** Tue Sep 15 2026 13:44:52 GMT+0530 (India Standard Time)
