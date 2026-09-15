# Research notes

Generated from the `research_notes` store by `npm run research -- export`.
Postgres holds the live rows; this file is what survives losing it.

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
