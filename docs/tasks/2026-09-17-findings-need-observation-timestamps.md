---
status: open
priority: P2
level: 4
opened: 2026-09-17
---

# Findings carry no observation time, so the freshness rule cannot be enforced

The published teardown states failure mode 4 as a rule:

> Stamp every finding with when it was observed, and re-verify before it reaches
> a human. Freshness is part of correctness.

**No finding carries a timestamp.** `src/codebase-audit.js` emits `kind`, `file`,
`line`, `evidence`, `why`, `confirm` — and nothing about when. R6.1 of the
requirements spec is unimplemented, which makes R6.2 unenforceable: there is no
window to be outside of.

## Why it matters beyond tidiness

Supabase auto-revokes keys it detects as leaked. A finding can be **dead before
it is sent**, and disclosing a rotated key to someone who checks is the fastest
way to lose the conversation — the exact failure the accuracy pitch exists to
avoid. Seven findings are currently sitting unsent and were measured on
2026-09-15.

## What would fix it

1. `auditCodebase` stamps `observedAt` on every finding it emits.
2. A `stale(finding, { windowDays })` helper, so "older than the window" is a
   fact rather than a judgement.
3. `verify-lead-before-contact` refuses to quote a count whose findings are
   outside the window, matching R5.3's existing requirement to re-derive.

## Testing it properly

The guard must fail: build a finding older than the window, assert the report or
the disclosure path refuses it, and confirm that test goes red before the fix.
