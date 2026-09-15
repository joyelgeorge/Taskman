---
name: verify-lead-before-contact
description: Use before sending anything to a lead the scanner produced, whenever a finding count from a sweep, dashboard, report or another agent is about to be repeated to a person outside this project, and whenever a lead is being ranked or chosen for outreach.
---

# Verify a lead before contacting anyone

## Overview

A sweep headline is a count of **findings**, not a count of **problems**. The two
differ by roughly 5x, and the gap always flatters us. Before a number reaches a
stranger, re-derive it from a fresh clone.

**The first thing a competent developer does with your email is check the
number.** An inflated count is not a small embarrassment — it is the end of that
conversation and, because they will say so publicly, of the cheap ones after it.
Verification is the least expensive sales work available.

## Measured, 2026-09-15

The vibe-app sweep reported **19 leads with CRITICAL findings**. Re-audited
against fresh clones, **4 had an actual exposed secret.**

| Repo | Headline | Verified `exposed-secret` |
|---|---|---|
| danielphillippe27-netizen/flyrpro | 71 crit | **1** (+ 70 missing-RLS across 12 files) |
| Chalmers007/ordering-platform | 14 crit | **9** (+ 6 no-auth admin routes) |
| lepefy-labs/lepefy-food-platform | 16 crit | **0** (17 missing-RLS) |
| zohaib-119/country-rise-we | 12 crit | **0** (12 missing-RLS) |
| Jpalmer95/kynda-coffee | 10 crit | **0** (10 missing-RLS) |

`missing-rls` is emitted **once per table**, so one systemic issue in one
`schema.current.sql` dump becomes seventy criticals.

## The procedure

```bash
git clone --depth 1 --quiet https://github.com/<owner>/<repo>.git "$TMP"
node -e "import('./src/codebase-audit.js').then(async m => {
  const f = await m.auditCodebase(process.argv[1]);
  const list = Array.isArray(f) ? f : f.findings;
  const byKind = {}, files = {};
  for (const x of list) { byKind[x.kind] = (byKind[x.kind]||0)+1; (files[x.kind] ||= new Set()).add(x.file); }
  console.log(byKind, Object.fromEntries(Object.entries(files).map(([k,v]) => [k, v.size])));
})" "$TMP"
rm -rf "$TMP"
```

Then report **distinct issues and distinct files per class**, never the total.

## Quick reference

| Finding class | Compels action? | Before you believe it |
|---|---|---|
| `exposed-secret` | **Yes — lead with it** | Hash occurrences: usually one key in N files |
| `command-injection` | Only if request-tainted | **4 of 4 were env vars in a local script** |
| `unauthenticated-admin-route` | **Assume wrong** | **6 of 6 were guarded.** Open the file |
| `missing-rls` | Secondary | Count tables, not findings |
| `ssrf`, `open-cors` | Not without hand-tracing | — |
| `date-shift`, `storage-divergence`, `silent-fallback` | No | Code smells; including them reads as noise |

**Full taxonomy, with the measurements behind each row:**
[references/finding-classes.md](references/finding-classes.md)

## Rules

- **Read-only.** Clone and audit. Never touch the running product, never use a
  credential you found, never verify a key by trying it.
- **Never write the secret down** — not in the repo, not in a note, not in the
  email. `scrubSecrets` covers JWTs and assignments; do not rely on it instead
  of not pasting the value.
- **Delete the clone** in a `finally`. Three of these fill a disk.
- Set a clone timeout **and** check free space first; a 400 MB repo plus a full
  disk reports as a clone failure that looks like a deleted repo.
- Record the verified counts as a research note (`npm run research -- add`), or
  the next session re-derives them.

## Real-world impact

Measured on 2026-09-15 across the 22 leads in the queue:

- The sweep called **19** leads critical. **7** carried a compelling finding.
  **4** had an exposed secret.
- Two consecutive drafts were about to send findings that do not exist: four
  `command-injection` findings that were environment variables in a local
  script, and six `unauthenticated-admin-route` findings that were all guarded.
- Both were caught only because a file was opened to get details **for the
  draft**. Neither would have survived first contact with the developer.

The cost of being wrong is not embarrassment. A developer who disproves your
first claim correctly concludes the rest is noise — **including the real
finding**, which in both cases was a live `service_role` key.

## Common mistakes

| Mistake | Why it costs you |
|---|---|
| Quoting the sweep's headline | It is ~5x high; being caught ends the conversation |
| Treating `missing-rls` count as severity | One issue counted per table |
| Ranking leads by total findings | Ranks RLS dumps above real key leaks |
| Assuming a clone failure means the repo is gone | Check `gh api repos/<r>` and `df -h` before concluding |

## The pipeline

This is one step of five. Each hands to the next; a step skipped is a step
somebody improvises later, under pressure, badly.

- **After this:** `send-and-log-outreach` — Once the numbers are verified, the message is drafted and handed over.

Choosing between them, or between this and anything else on the board, is
`deciding-the-next-step`.