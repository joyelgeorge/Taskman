---
status: open
priority: P1
level: 3
opened: 2026-09-15
---

# `findUnauthenticatedAdminRoutes` reports guarded routes as unauthenticated

**Priority: P1.** Found 2026-09-15 while drafting the Chalmers007 disclosure.

## What

`src/codebase-audit.js` flagged **six** admin routes in
`Chalmers007/ordering-platform` as having no authentication. All six were read by
hand. **All six call `requireSuperAdmin()`** and return 401/403:

```
src/app/api/admin/check-uber-customer-id/route.ts
src/app/api/admin/dispatch-health/route.ts
src/app/api/admin/set-demo-uber-id/route.ts
src/app/api/admin/test-preview/route.ts
src/app/api/admin/webhooks/drain/route.ts
src/app/api/admin/tenants/[id]/route.ts
```

A 100% false-positive rate on this repository.

## Why it is P1 rather than a bug report

It was one step from being sent to a stranger. A developer who opens
`tenants/[id]/route.ts` sees `requireSuperAdmin()` on line 20 and stops reading
the email — and correctly concludes the rest is noise too, including the
service_role key that is entirely real.

It also inflates the lane's own numbers: `afintech510/easternLM` (14) and
`Mehdi-Safraoui/lms-platform` (4) are ranked on this class and have **not** been
hand-checked. The verified queue in `docs/outreach/2026-09-15-verified-lead-queue.md`
counts them as compelling; that is now in doubt.

## Likely cause

The detector appears to match the route file's own text for auth tokens. This
codebase delegates the check to a helper — `requireSuperAdmin` from
`@/lib/admin/guard` — so the words the detector looks for (`getUser`, `session`,
`auth`) are in the helper, not the route.

Any project with a named guard helper will trip this, which is most of them.

## Done looks like

The detector recognises a delegated guard: an imported identifier matching
`require*`, `assert*`, `guard*`, `ensure*` that is called before the handler's
work. Add the six routes above as a regression fixture — and **verify by
breaking**: remove the guard from a fixture and confirm the finding returns.

Then re-audit `easternLM` and `lms-platform` and correct the queue.
