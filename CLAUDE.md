# Taskman — Claude Code Project Guidelines & Invariants

Taskman is an autonomous revenue, telemetry, and execution engine designed with strict economic verification, human gating, and deterministic safety rules.

## ⚠ CRITICAL STRATEGIC FINDING (2026-09-08) — read first

**The gap that kept revenue at $0: Taskman built enormous SUPPLY (detection,
drones, scanner, scoring) and never validated DEMAND — a person demonstrably
paying — before building. Every lane died at the payment step. Fix the flow:
start from visible, already-paying demand, then point proven capability at it.**

Consequences that now govern revenue work:

- **The validated paying market is securing "vibe-coded" apps** (Lovable / Cursor
  / Bolt / v0 / Replit on Supabase/Firebase). Proven paying: scanners at $5–29/mo,
  Fiverr fix gigs $80–125, dedicated shops (humansfix.ai). 98% of scanned
  vibe-coded apps had a flaw. This is CASH; OSS bounty disclosure is only a
  CREDENTIAL (see below).
- **The vuln class that matters is NOT server-side injection.** It is exposed
  Supabase `service_role` keys, missing Row-Level Security, secrets in the client
  bundle, open CORS, no-auth admin routes (CWE-284/200/312/942/798). Detectors
  for this class: `findExposedSecret`, `findOpenCors` (PR #218), with missing-RLS
  and no-auth-route to follow.
- **OSS vuln bounties do not pay.** Confirmed against data: npm CWE-22/78/918
  disclosure routes through GitHub/NVD, not paid channels; budibase and n8n (the
  heaviest offenders) run no paid program. A confirmed OSS finding (e.g.
  project-golem, CWE-22) is a reputation credential and scan-service proof, not
  revenue. Do not chase OSS bounties for cash.
- **Wedge:** the scan-only niche is crowded. Compete on FIX + verified proof at
  the Fiverr-proven $80–125, not on being another free scanner.
- **Active plan:** demand-first tasks #212–#217. Revenue work must not deviate
  from the vibe-coded-app-security direction without a new demand-validation pass.

## ⚠ CRITICAL FINDING (2026-09-11) — `OPPORTUNITY_FEED` is fabricated, not scraped

**Every entry in `src/autonomous-engine.js`'s `OPPORTUNITY_FEED`
(`bounty-algora-101`, `bounty-fiverr-audit-201`, `bounty-algora-102`,
`bounty-dispute-chargeback-301`, `bounty-api-rate-limiter-401`) is hardcoded
seed data with no real counterparty. None is the output of a live scraper
hitting Algora, Fiverr, or any other marketplace.**

Evidence:

- Every `source` field is a generic category label ("Algora / GitHub OSS
  Bounty", "Top-Rated Fiverr Digital Agency", "Fintech Micro-SaaS Bounty") —
  not a listing name, org, repo, or URL. A real scrape would carry a specific
  listing ID/link.
- `bounty-fiverr-audit-201` traces to `scripts/complete-fiverr-audit-settlement.js`,
  which **generates its own fake 120-order dataset in-code**
  (`for (let i = 1; i <= 120; i++) { const gross = ... }`) and **hardcodes
  `payoutStatus: 'CLEARED'`** with no PayPal API check, no bank confirmation,
  and no settlements-table row behind it. The client name "Apex Digital
  Creative" appears nowhere except as a string this script invented.
- `bounty-algora-101` / `-102` ("PR SUBMISSION" docs, later published as public
  gists) reference `Bounty Target: algora-101` — an internal ID, not a real
  Algora bounty URL or target repository. No PR was ever opened against any
  external repo for either (consistent with the anti-auto-submit rule below,
  but also confirming there is no real bounty on the other end).
- `bounty-dispute-chargeback-301` and `bounty-api-rate-limiter-401` never
  progressed past `staged-*` deliverable JSON files — no merchant name, order
  data, dispute ID, or company reference ties either to a real case.
- The published gists (e.g. `gist.github.com/joyelgeorge/...`) are real GitHub
  objects — but a real gist only proves a document was published, not that the
  underlying client, bounty, or payment it describes exists. Do not treat a
  gist, staged JSON, or "CLEARED" status as evidence of revenue by itself.

**Rule going forward:** treat every `OPPORTUNITY_FEED` entry as fictional
until it carries a verifiable external reference (a real Algora bounty URL,
a real Fiverr order/gig ID, an actual external PR URL, a matching
`settlements` row with `externalRef`). Do not build execution pipelines
(reports, invoices, "cleared" settlements) against demand that has not been
independently verified to exist — this is the same supply-before-demand
failure the 2026-09-08 finding above already named, now confirmed concretely
in the current opportunity feed.

### `data/staged-deliverables/` breakdown — not all fake in the same way

97 files exist (not the 600+ a prior summary claimed), and within each
candidate they are near-duplicates re-staged on a timer, not distinct runs —
e.g. all 34 `bounty-algora-101` files are byte-identical except for
`generatedAt` and whether a later commit added a `payoutLink` field. The
underlying claims split into two different failure modes:

| Candidate | `patchFile` claimed | Real code exists? | Real tests pass? | Verdict |
|---|---|---|---|---|
| `bounty-algora-101` | `solutions/bounty-algora-101.js` (path doesn't exist — no `solutions/` dir anywhere in the repo) | Yes — `src/stripe-webhook-mutex.js` | ✅ `test/stripe-webhook-mutex.test.js`, 3/3 pass | Real, working code. `testsPassed: true` happens to be true, but only by coincidence — it references a nonexistent `patchFile` path and no real bounty/counterparty exists on the other end. |
| `bounty-algora-102` | `solutions/bounty-algora-102.js` (also doesn't exist) | Yes — `src/accessibility-calendar-tokens.js` | ✅ `test/accessibility-calendar-tokens.test.js`, 3/3 pass | Same as above: real code, same missing-counterparty caveat. |
| `bounty-dispute-chargeback-301` | `solutions/bounty-dispute-chargeback-301.js` | **No source file anywhere in `src/`** | N/A — nothing to test | `status: 'TESTED_AND_READY'` and `testsPassed: true` in the staged JSON are **fabricated**: there is no implementation, so nothing was tested. |
| `bounty-api-rate-limiter-401` | `solutions/bounty-api-rate-limiter-401.js` | **No source file anywhere in `src/`** | N/A | Same fabrication as chargeback-301. |
| `fiverr-audit-201` | — | Reconciliation code (`src/commercial-wedge.js`) is real and runs correctly | ran successfully | Code works; the client and transaction data it ran on were self-generated fiction (see finding above). |

**Reading this correctly:** `bounty-algora-101` and `-102` are the one
genuine asset in the feed — real, tested code that could be submitted as an
actual PR if a human operator finds a matching live bounty (per the
anti-auto-submit rule below). `bounty-dispute-chargeback-301` and
`bounty-api-rate-limiter-401` are worse than unverified demand: they assert
`testsPassed: true` for code that does not exist in the repository at all.
Any staging script that can set `testsPassed: true` without a corresponding
source file and a real test run is a bug — trace and fix the script that
produced these two before trusting its output again (likely a sibling of
`scripts/execute-fiverr-audit.js`).

## Core Rules for Claude Code Agents

1. **Verify Before Asserting (`taskman-verify`)**:
   - The source of truth is the database, the filesystem, or the API — never a previous model response, commit message, or dashboard number.
   - Zero rows in `settlements` means zero revenue. Never fabricate or assume income.

2. **Never Auto-Submit External Pull Requests (`taskman-bounty-triage`)**:
   - Algora terms prohibit robotic access, and 37 open-source projects ban AI contributions outright (Issue #194).
   - The coding agent produces a candidate fix and disclosure text (`CANDIDATE_PREPARED`). A human operator decides whether to submit.

3. **Deterministic 5-Gate Triage (`taskman-bounty-triage`)**:
   - 73.2% of agent bounties are prompt-exfiltration honeypots (#193). All listings must pass:
     1. `TRAP_CHECK` (prompt/credential exfiltration detection)
     2. `FUNDING_CHECK` (verified escrow $\ge \$5$)
     3. `REACHABILITY_CHECK` (no geo-walls / regional limits)
     4. `SCOPE_CHECK` (no subjective UI/UX, product meetings, hardware, or private VPNs)
     5. `AI_POLICY_CHECK` (repo does not ban AI contributions)

4. **Dual Database Storage & Schema Agreement (`taskman-db-migration`)**:
   - Code must run in both memory mode (`databaseEnabled: false`) and PostgreSQL mode (`databaseEnabled: true`).
   - Every new table or constrained column MUST have a numbered migration in `packages/db/migrations/` and be verified in `test/schema-code-agreement.test.js`.

5. **Live Revenue Lane (`taskman-audit-lane`)**:
   - Live reconciliation audit tool: https://taskman-operator.web.app
   - Payment: **contingency, not a flat fee** — 20% of what the customer confirms they
     recovered, nothing if they recover nothing. Every established operator in this
     space prices this way (TrueOps 10%, Refully 18%, GETIDA 25%), because a stranger
     will not hand their bank export to an unknown for $20 up front.
     Collected via `https://paypal.me/joyelgt` — the /20USD suffix is a leftover from
     the flat-fee model and should not be used for a contingency invoice.

## Essential Commands

```bash
# Run unit test suite (582+ tests)
npm test

# Verify schema-code agreement
node --test test/schema-code-agreement.test.js

# Build audit site bundle
npm run build:audit-site

# Deploy audit frontend
firebase deploy --only hosting
```

## Available Custom Skills (`.claude/skills/`)
- `taskman-verify`: Check claims against reality before believing or acting on them.
- `taskman-bounty-triage`: 5-gate deterministic bounty triage & anti-auto-submit guard.
- `taskman-db-migration`: Migration protocol, dual storage patterns, and schema agreement.
- `taskman-audit-lane`: Deployment, PayPal settlement reconciliation, and order fulfillment.
