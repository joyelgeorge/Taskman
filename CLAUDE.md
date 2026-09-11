# Taskman — Claude Code Project Guidelines & Invariants

Taskman is an autonomous revenue, telemetry, and execution engine designed with strict economic verification, human gating, and deterministic safety rules.

## 📌 READ FIRST — `docs/READ-FIRST.md`

Before writing any code in this repository, read `docs/READ-FIRST.md`. It holds
the one question every change has to answer — **which settlement row does this
produce, and who pays it?** — and the verified current position: the code path
to the first dollar is complete and has never been travelled. The constraint
has not been code for some time.

Work that is found but deliberately not done goes in `docs/tasks/` rather than
blocking whoever found it. Two sessions share this working tree; if another
session is mid-edit in a file you need, park a task and carry on.

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
