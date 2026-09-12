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
