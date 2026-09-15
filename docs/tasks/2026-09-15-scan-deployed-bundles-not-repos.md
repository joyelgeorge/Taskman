---
status: open
priority: P1
level: 3
opened: 2026-09-15
---

# Scan deployed bundles, not GitHub repos

**Priority: P1.** Raised 2026-09-15 from
`docs/research/2026-09-15-is-this-lane-worth-48-more-attempts.md`.

## What the measurement says

| | Our lane | Deployed-bundle scanning |
|---|---|---|
| Targets | 199 candidates from GitHub code search | **20,052 URLs** from five indie-launch directories |
| Carrying an exposed secret | **4** | **2,217 domains (11.04%)** |

Roughly **50x the hit rate against ~100x the pool**, using the same detector
class we already have.

## Why it also outlives our current surface

Supabase auto-revokes the new `sb_secret_` format when GitHub secret scanning
finds it in a public repo. As projects migrate off legacy `service_role` JWTs,
**the public-repo lane's supply is a depleting stock**. A key in a shipped
JavaScript bundle is not in a repo, so that mitigation never reaches it.

## Why it was not done now

Two disclosures are in flight and the reply window has not elapsed. Changing the
lead surface before knowing whether *any* message converts would be building
supply again — the failure this project has already had twice. **Do this after
the first reply or the first NO_RESPONSE, not before.**

## Done looks like

`scanDeployedApp(url)` beside `scanRepo(repo)` in
`packages/core/jobs/vibe-app-security-default.js`: fetch the page, pull its JS
bundles, run `findExposedSecret` over them. Read-only — fetch what the server
chose to serve publicly, never use a key, never touch a database.

Target list from indie-launch directories rather than GitHub code search.

**Note the anon/service_role distinction matters more here than in a repo:** an
`anon` key in a client bundle is expected and safe. Only `service_role` (or
`sb_secret_`) is a finding. A detector that flags anon keys in bundles would
produce a 100% false-positive rate and is the fastest way to become a beg-bounty
sender.
