# The primary lead engine is not running at all

**Priority: CRITICAL.** Found 2026-09-12 while questioning the search premise.

## What

`cron-vibe-lead-sweep.yml` describes itself, in its own header:

> This is the **LOW-YIELD background funnel**; **warm-lead-scout is the primary
> engine**.

`warm-lead-scout` — the engine the repo calls primary — has:

- **no cron**
- **no script**
- **no persistence**
- exactly one reference anywhere in the codebase: that comment, inside the other
  funnel's workflow

It runs only when a human invokes the skill by hand in a Claude session, and its
output goes nowhere.

Meanwhile a full session was spent giving the *low-yield* funnel lead
persistence, scan memory, a migration, a CI database and a migration step.

## Why it matters

Warm inbound intent — someone already asking for help securing their AI-built
app — converts on a different order of magnitude from cold disclosure to a
stranger whose repo you scanned uninvited. The repo knows this; it wrote it
down; and then automated the other one.

## Done looks like

Decide, explicitly, one of:

1. **Automate it** — a script that runs the skill's search, persists qualified
   warm leads through `createLead` (they have a real URL, so they are
   `REFERENCED` under `src/evidence-tier.js`), and a cron. It is the same
   plumbing the vibe sweep just got.
2. **Or demote the claim** — if it cannot be automated because it needs human
   judgement to read a thread, then say so in the comment and stop calling it
   the primary engine while the secondary one gets all the engineering.

Either is fine. The present state — the primary engine being the only one
nobody built — is not.
