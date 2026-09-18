---
status: open
priority: P1
level: 4
opened: 2026-09-18
---

# NPM postinstall/preinstall curl-pipe-to-bash detector

Raised from a Jez research pass, 2026-09-18 (`docs/research/NOTES.md`'s
newest surviving entry, recorded before an uncommitted export overwrote most of
what was around it — see the note at the bottom of this file):

> NPM package postinstall scripts executing curl pipes to bash bypass static
> package metadata inspection.

No detector for this exists in `src/codebase-audit.js` today (checked directly,
not assumed — `grep -i postinstall` across `src/` and `packages/` before writing
this file). The prompt template in `src/jez-researcher.js` that asked for this
finding is a research-generation instruction, not a detector; the finding it
produced has never been turned into code.

## Why P1, not P0

It is capability, not distribution — level 4, so it cannot itself clear
`docs/READ-FIRST.md`'s bar. Priority above the other two detector tasks opened
today because it is the one with a product already scoped and waiting on it:
[2026-09-18-package-preflight-risk-product.md](2026-09-18-package-preflight-risk-product.md).

## Scope

`findPostinstallShellPipe(file, text)` in `src/codebase-audit.js`, matching the
existing `find*` function shape (see `findExposedSecret`, `findMissingRls`
immediately above it in the file for the pattern: input `(file, text)`, output
`{kind, file, line, evidence, why, confirm}[]`).

- Parse `package.json`'s `scripts.postinstall` / `scripts.preinstall`.
- Flag a script that pipes `curl`/`wget` output into `sh`/`bash`/`node -e`.
- False-positive risk named in the original research prompt: **native
  `node-gyp` builds** (e.g. `node-gyp rebuild`, `prebuild-install`) are a
  postinstall script too and must not trip this. Test against a real
  `node-gyp`-using package before calling it done.

## Done looks like

The function exists, has a test asserting it fires on a synthetic curl-pipe
postinstall script and does not fire on a `node-gyp rebuild` one, and is wired
into whatever calls the other `find*` functions in the vibe-app-security scan
path (`packages/core/jobs/vibe-app-security.js` / `src/codebase-audit.js`'s
exported `auditCodebase`).

## Aside, not this task's job to fix

`docs/research/NOTES.md` has an uncommitted change (`git status` at time of
writing) that deleted roughly fifteen prior research entries — the easternLM
findings, competitor pricing, the self-serve-scanner-is-live status note — and
replaced them with only this one. Worth checking whether that's an export
regression before the working tree state changes again.
