# Question the premise: are vibe-coded businesses even on public GitHub?

**Priority: CRITICAL — this may invalidate the whole lane.** Raised 2026-09-12.

## The doubt

The scan lane assumes that businesses built on Lovable, Bolt, v0, Cursor and
Replit have their source **public on GitHub**. That assumption has never been
tested, and there is reason to think it is mostly false:

- Those platforms deploy hosted apps. Pushing to a public repository is an extra,
  optional step.
- A founder with paying customers has an active incentive *not* to publish the
  source of their product.
- The repos that *are* public skew to templates, tutorials, portfolio pieces and
  abandoned experiments — which is exactly what the `genuine` qualifier spends
  its time rejecting.

If that is right, the lane's structural ceiling is not the filters. It is that
the population of "vibe-coded app with paying customers AND public source" may be
close to empty, and no amount of query tuning reaches it.

## Why this matters more than the other tasks

`CLAUDE.md` names securing vibe-coded apps as **the validated paying market** —
proven by scanners at $5–29/mo, Fiverr fixes at $80–125, and dedicated shops.
That demand is real. The question is only whether **public repo scanning** is a
way to reach it, or whether it is this project's third attempt at building
supply against a channel nobody validated.

The warm-lead route reaches the same market from the other end: people who are
already asking. See `2026-09-12-primary-lead-engine-is-not-running.md`.

## Done looks like

A measurement, not an argument. From one loosened sweep, record:

- candidates scanned
- how many had a confirmed finding
- how many passed `genuine`
- **how many of those are plausibly a real business with customers** — a custom
  domain, a pricing page, live payment keys

If the last number is zero or one across a few hundred repos, write the lane up
in `packages/core/territory/registry.js` as KILLED with the count, and move the
effort to the warm-inbound engine. If it is meaningfully non-zero, the filters
are the problem and the other tasks are worth doing.

**Do this measurement before investing further in the scanning path.**

---

## Partially answered, 2026-09-12 — by the first real sweep

Run [34670002340](https://github.com/joyelgeorge/Taskman/actions/runs/34670002340)
scanned 36 repositories. The results correct this task's premise in both
directions, so it stays open but narrower.

**The premise was too pessimistic.** Real businesses with custom domains ARE
present in public results:

- `Dicoangelo/frontier-alpha` — frontier-alpha.metaventionsai.com, a company
  (Metaventions AI), 116 MB, pushed two days before the scan, **4 CRITICAL
  findings**
- `SunrisesIllNeverSee/sigrank-app` — signalaf.com, 68 MB, active
- `goklab/guardvibe` — guardvibe.dev (note: sells vibe-coding security — a
  competitor, not a prospect)

**But the population is thin and heavily diluted.** Of 36 scanned, roughly thirty
were templates by name: `pixio-api-starter`, `nextjs-boilerplate`,
`dream-starter-kit`, `LaunchKit`, `saas-zero`, `stripe-saas-boilerplate`,
`saas-starter-nextjs`. That part of the premise held.

**And the qualifier was discarding the good half.** `frontier-alpha`, the only
repo in the run with critical findings, was rejected because its description
said "portfolio optimization". Fixed — see the word-sense commit — but it means
every earlier conclusion about this lane's yield was measured through a filter
rejecting nine of ten plausible businesses.

## What is still open

Re-run the sweep with the fixed qualifier and count again. The question is no
longer "do businesses exist here" — they do — but **how many per hundred
scanned, and do they carry the finding classes that actually pay**
(`exposed-secret`, `missing-rls`), rather than the ssrf/path-traversal classes
CLAUDE.md says do not.

Both leads persisted in this run had **zero** critical findings.

---

## Answered on yield, 2026-09-14 — the premise survives

Run [34688151638](https://github.com/joyelgeorge/Taskman/actions/runs/34688151638),
the first with the fixed qualifier and the loosened search:

| | Run 1 (2026-09-12) | Run 3 (fixed qualifier) |
|---|---|---|
| Candidates found | 36 | **199** (budget 120) |
| Scanned | 36 | **112** |
| Passed `genuine` with a finding | 2 | **27** |
| Carrying ≥1 CRITICAL | **0** | **19** |

Run [34857396120](https://github.com/joyelgeorge/Taskman/actions/runs/34857396120)
(2026-09-14, scheduled) scanned 27 more and found 5 leads, 3 with criticals, and
skipped 93 already-scanned repos — so `scanned_repos` works and the pool has not
run dry.

**The measurement this task asked for is done, and it does not kill the lane.**
17% of scanned repos are a business carrying a critical finding, and the classes
are the ones CLAUDE.md says pay — `exposed-secret` and `missing-rls`, not ssrf.

## The caveat the first disclosure exposed

Counts of `crit` are **issue counts, not distinct problems.** The headline
`flyrpro (73 issues, 71 crit)` was verified by hand against a fresh clone and is
really:

- `exposed-secret` — **1** (a `service_role` key literal, genuinely serious)
- `missing-rls` — **70, across 12 files**, 56 of them in one `schema.current.sql`
  dump: *one* systemic issue counted once per table
- `ssrf` — 2

So "19 leads with criticals" is 19 leads worth verifying, not 19 × dozens of
holes. Anything sent to a human must be hand-verified first — see
`docs/outreach/2026-09-12-flyrpro-disclosure.md`, which corrects our own number
in writing.

## What is still open

Nothing about the surface. What is untested now is **the response rate**: 19
qualified leads, 1 disclosure drafted, 0 sent. That question belongs to
`src/outreach-log.js` and the 50-attempt kill criterion, not here. Close this
task once the first attempt is logged.
