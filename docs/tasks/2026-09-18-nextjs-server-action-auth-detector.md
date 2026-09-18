---
status: open
priority: P2
level: 4
opened: 2026-09-18
---

# Next.js Server Action auth-absence detector

`findUnauthenticatedAdminRoutes` in `src/codebase-audit.js` (checked directly,
2026-09-18) only fires on files/handlers whose **path or route string contains
"admin"**. A Next.js Server Action performing a privileged mutation has neither:

```js
'use server'
export async function deletePost(id) {
  await db.posts.delete(id); // no auth check, no "admin" anywhere
}
```

This slips past the existing detector entirely — different code shape (a
directly-exported async function called like an RPC from a client component,
not a route registration), not a variant of what's already covered.

## Scope

`findUnauthenticatedServerAction(file, text)`, same shape as the other `find*`
functions. From a prior research pass (`docs/research/NOTES.md`, since
overwritten — see the aside in
[2026-09-18-npm-postinstall-supply-chain-detector.md](2026-09-18-npm-postinstall-supply-chain-detector.md)):
an exported async function containing an `await x.(create|update|delete)` call
with no preceding auth guard in the same function body. Reuse
`findUnauthenticatedAdminRoutes`'s delegated-guard logic (the
`require|assert|ensure|verify|check|validate` / `Guard|Permission|Authoriz`
regex) rather than re-deriving it — that logic was hand-tuned against a real
false-positive (`Chalmers007/ordering-platform`, six routes, all missed on the
first pass) and should not be rewritten from scratch for a sibling detector.

## Why P2

Widens the vibe-app-security wedge's detection surface but doesn't unblock a
distribution question — the wedge's constraint is cold-outreach reply rate
(2 sent, 0 answered, per `npm run next`), not scan coverage. Real, but not
what's currently stalling the in-flight lane.

## Done looks like

Function exists, tested against a synthetic unguarded Server Action (fires) and
a synthetic one calling a delegated guard helper (doesn't fire), wired into the
same scan path as `findUnauthenticatedAdminRoutes`.
