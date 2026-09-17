# Research notes

Generated from the `research_notes` store by `npm run research -- export`.
Postgres holds the live rows; this file is what survives losing it.

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
