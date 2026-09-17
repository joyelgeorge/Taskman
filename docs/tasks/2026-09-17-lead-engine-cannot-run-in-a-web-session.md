# Neither lead engine can run in a Claude Code web session

Found 2026-09-17 trying to actually run them. Both are blocked by the
environment rather than by any defect in the code, and neither block is
something to route around.

## The cold drone: `scripts/hunt-vibe-leads.mjs`

Two independent blockers:

1. **`gh` is not installed.** `generateCandidates()` shells out to
   `gh api search/repositories`, so the sweep has no input at all. The script
   also uses `gh api repos/<repo>` for metadata, though that path fails softly.
2. **Cloning third-party repositories is refused.** `git clone` of an
   out-of-scope public repo fails with *"could not read Username for
   'https://github.com'"*, while the identical command against the in-scope
   repository succeeds. This is the session's repository scoping — an
   authorization boundary — not a proxy hiccup.

Verified both ways on 2026-09-17, so it is the scoping and not broken git.

## The warm engine: `warm-lead-scout`

Runs, but cannot reach where the intent is. **Reddit and Stack Overflow both
refuse the crawler outright** (`400 … domains are not accessible to our user
agent`), and the skill names Reddit as one of the warmest surfaces. A headless
browser could render those pages; doing so would be routing around a stated
refusal, so it was not done.

What the reachable surface returns instead is *suppliers* — competitors' content
marketing and Fiverr sellers — across six differently-worded queries. Zero
qualified warm leads. See
`docs/research/2026-09-17-warm-lead-run-and-the-price-that-moved.md`.

## Why this matters more than it looks

`docs/tasks/2026-09-12-primary-lead-engine-is-not-running.md` records that the
primary lead engine has no cron, no script and no persistence. This adds the
part that was not known: **even fully built and scheduled, neither engine can
run in the environment where the work is being done.** Building more of either
from a web session cannot be tested from a web session, which is how a pipeline
gets finished and never travelled — the failure this repository has already had
once.

## What would fix it

Pick one deliberately, rather than by default:

- **Run the drone where GitHub is reachable** — the operator's own machine, or a
  GitHub Actions workflow in this repo (`gh` and a token are both present in
  Actions, and the scan is read-only and public-source, which fits a scheduled
  job well). Actions is probably the honest answer: it is the one runtime this
  project already has that can legitimately reach arbitrary public repos.
- **For the warm engine, accept that it is operator-driven.** Reddit and Stack
  Overflow are readable by a person in a browser. The skill already says the
  human posts; this makes clear the human must also *look*. Claude can draft
  replies from pasted threads, which keeps it useful without pretending the
  search half is automatable from here.
- **Before either:** note the price finding in the research doc. It is not
  obvious that more leads at the measured price point are worth generating.
