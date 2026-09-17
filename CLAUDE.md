# Taskman — Claude Code Project Guidelines & Invariants

Taskman is an autonomous revenue, telemetry, and execution engine designed with strict economic verification, human gating, and deterministic safety rules.

## ▶ START OF EVERY SESSION — do this before anything else, unprompted

1. `npm run next` runs automatically via the SessionStart hook in
   `.claude/settings.json`. Read its output. It is the verified position.
2. **Invoke `deciding-the-next-step`** and say which band the chosen action is
   in. Do this without being asked, including when the user opens with a
   specific request — if the request is band 4 while a band 1 or 2 action is
   available, say so in one sentence, then do what they asked.
3. When the user says **"revenue"**, that means: find the missing skill on the
   path to real revenue and add it to this repo. Not analyse, not report.

The pipeline skills load themselves from their triggers. The ones that need a
deliberate call are `deciding-the-next-step` at session start and
`brainstorming-revenue-moves` whenever a lane is waiting, blocked or dead.

## 📌 READ FIRST — `docs/READ-FIRST.md`

Before writing any code in this repository, read `docs/READ-FIRST.md`. It holds
the one question every change has to answer — **which settlement row does this
produce, and who pays it?** — and the verified current position: the code path
to the first dollar is complete and has never been travelled. The constraint
has not been code for some time.

Work that is found but deliberately not done goes in `docs/tasks/` rather than
blocking whoever found it. Two sessions share this working tree; if another
session is mid-edit in a file you need, park a task and carry on.

## What this work is (and is not)

Taskman's security lane is **defensive vulnerability disclosure and remediation**,
the same category as a security consultancy's free-finding-then-paid-fix model.
Stated plainly so the whole system is read correctly:

- We read **publicly available** code and public bundles. We do not access private
  systems, use credentials we find, or pull data through an unprotected endpoint —
  reading public code is research; touching a live system is not ours to do.
- We **tell the owner**, with enough detail to act and never a public recipe. The
  disclosure is free and unconditional. A paid offer, if any, is for the **fix**,
  and is separate.
- A person — the operator — sends every message and makes every contact. The
  software prepares; it never reaches out on its own.
- We describe risk in the owner's language ("an attacker could…", the CWE class) —
  that is how a finding is explained, not a statement of intent. Our intent is that
  it gets fixed.

This is the line between welcomed security help and the pattern that gets ignored
or reported. Everything in the pipeline skills exists to keep the work on the
right side of it, and none of those rules is optional.

## ⚠ CRITICAL STRATEGIC FINDING (2026-09-08) — read first

**The gap that kept revenue at $0: Taskman built enormous SUPPLY (detection,
drones, scanner, scoring) and never validated DEMAND — a person demonstrably
paying — before building. Every lane died at the payment step. Fix the flow:
start from visible, already-paying demand, then point proven capability at it.**

Consequences that now govern revenue work:

- **The validated paying market is securing "vibe-coded" apps** (Lovable / Cursor
  / Bolt / v0 / Replit on Supabase/Firebase). Proven paying: scanners at $5–29/mo,
  ~~Fiverr fix gigs $80–125~~, dedicated shops (humansfix.ai). 98% of scanned
  vibe-coded apps had a flaw. This is CASH; OSS bounty disclosure is only a
  CREDENTIAL (see below).

  > **Price correction, 2026-09-17.** The $80–125 Fiverr figure no longer holds.
  > Seven live gigs measured that day price the same fix at **$10–40**, none above
  > $40, while free scanning has arrived beneath the $5 tier (SafeToShip, CheckVibe)
  > and a named firm charges **€1,500** for the same RLS audit (theswarm.at). The
  > market went barbell and the $80–125 middle — the exact tier the wedge below
  > targets — is the part that hollowed out. The vulnerability data is unaffected
  > and if anything stronger. Evidence:
  > `docs/research/2026-09-17-warm-lead-run-and-the-price-that-moved.md`.
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
- **Wedge:** the scan-only niche is crowded — thirteen named competitors counted
  on 2026-09-17, and scanning is now free at the bottom. ~~Compete on FIX +
  verified proof at the Fiverr-proven $80–125~~ — that tier is gone (see the
  price correction above). The open question is whether the money is at the
  four-figure audit end, which is a trust business a machine cannot originate.
  **Do not price new work against $80–125 without re-measuring.**
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

5. **Revenue jobs run through the runner (`packages/core/jobs/runner.js`)**:
   - A wedge is a descriptor in `EXPLORED_TERRITORIES` with `{distribution, economics, rail, stages}`.
   - Four gates, each proven by mutation: `intervene` needs an operator approval
     token; `charge` needs a checkable external reference from `verify`; the
     charge stage *describes* a settlement and **the runner** writes it through
     `recordSettlement`; every stage run is logged to `job_runs` before its
     result returns.
   - A job that declares `charge` without `verify` is refused at definition time.

6. **Live Revenue Lane (`taskman-audit-lane`)**:
   - Live reconciliation audit tool: https://taskman-operator.web.app
   - Payment: **contingency, not a flat fee** — 20% of what the customer confirms they
     recovered, nothing if they recover nothing. Every established operator in this
     space prices this way (TrueOps 10%, Refully 18%, GETIDA 25%), because a stranger
     will not hand their bank export to an unknown for $20 up front.
     Collected via `https://paypal.me/joyelgt` — the /20USD suffix is a leftover from
     the flat-fee model and should not be used for a contingency invoice.

## Essential Commands

```bash
# What to do next, decided against the stores rather than from memory
npm run next

# List revenue lanes; RUNNABLE ones have stages the runner executes
npm run job -- list
# Run the wired lane. Without --approve it stops at intervene, by design.
npm run job -- run vibe-app-security --repos owner/name

# Reconstruct the verified position — run this FIRST in any session.
# Exits non-zero if a store could not be read; never substitutes a zero.
npm run brief

# Record what a research pass found, so it outlives this session
npm run research -- add "claim" --source "where it can be checked"

# Regenerate the counted block in docs/tasks/README.md
npm run tasks

# Run unit test suite (895 tests as of 2026-09-15)
npm test

# Verify schema-code agreement
node --test test/schema-code-agreement.test.js

# Build audit site bundle
npm run build:audit-site

# Deploy audit frontend
firebase deploy --only hosting
```

## Available Custom Skills (`.claude/skills/`)

- `expanding-the-search`: contrasting perspectives with disagreement surfaced, symbolic pruning, and changing the search axis when a lane is exhausted. Use when a source dries up or one heuristic is about to be trusted.
- `self-serve-revenue-lane`: earn without contacting anyone — a freemium product where the customer scans their own app and pays to unlock the fixes. Use when outreach is the bottleneck.
- `brainstorming-revenue-moves`: generate money-making options without filtering, then score on distribution, fulfilment, rail and price. Use when a lane is waiting or dead.
- `deciding-the-next-step`: run `npm run next`, then pick by what the action produces — not by what is easiest to start. Waiting is a valid answer and usually the right one.

**The revenue pipeline, in order. Every step downstream of a lead has a skill;
this is where the project has always stalled.**
- `verify-lead-before-contact`: re-derive the finding counts before a number reaches a stranger. Measured 2026-09-15: the sweep's 19 "critical" leads are 4 with a real exposed secret.
- `send-and-log-outreach`: draft it, the **operator** sends it, log the attempt. An unlogged send leaves the lane looking untried.
- `handle-the-reply`: what to do the moment somebody answers — the thing this project has never had.
- `price-and-deliver-the-fix`: the scan is marketing, the fix is the product. $80–125 per fix, or ~20% contingency.
- `close-to-settlement`: a real `externalRef`, the right rail, and minor units (₹500 is `50000`).

- `taskman-verify`: Check claims against reality before believing or acting on them.
- `taskman-bounty-triage`: 5-gate deterministic bounty triage & anti-auto-submit guard.
- `taskman-db-migration`: Migration protocol, dual storage patterns, and schema agreement.
- `taskman-audit-lane`: Deployment, PayPal settlement reconciliation, and order fulfillment.
