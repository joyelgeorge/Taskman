---
status: open
priority: P2
level: 3
opened: 2026-09-17
---

# Sellman: the teardown series

**One published artifact is an anecdote. The second one makes it a method.**

The first teardown is live:
https://gist.github.com/joyelgeorge/657593108ec060655ec7dcee2b2b426e — our own
scanner called 19 apps critical; hand-verifying all 22 found seven worth sending.

Its power is not the writing. It is that **every number came from a measurement
nobody else publishes**: a 6-of-6 false positive, 70 findings across 12 files,
four unreachable injections, and two errors caught mid-draft and left in.

## The repeatable shape

Each piece is: *a claim our own tooling made → what checking it actually found →
what changed in the code as a result.* Grounded in scan data the repo already
produces, so writing one costs a day and requires no new research.

Candidates, in order of how much evidence already exists:

1. **"We shipped a refuter that makes our own numbers smaller"** — the
   reachability module, the flyrpro case, and why no scanner vendor wants this.
2. **"Your scanner's count has no unit"** — 70-vs-12, and the `pg_tables` query
   a reader can run in ten seconds.
3. **"Eight wrong numbers in a piece about wrong numbers"** — the drafting log of
   the first teardown. Unusually honest, and the most quotable thing here.

## Why it is free marketing that fits the constraint

No sales conversation, no outbound, no relationship to originate. The reader
self-selects: only someone holding a frightening scan report reads a breakdown
of scan-report accuracy.

## Done looks like

A second piece published, and a measurement of whether the first one drew
anything. **A week of silence is data; six hours is noise.**

## Do not

Write a third before measuring the first two. This project's named failure is
producing supply nobody asked for, and a content series is the easiest possible
place to do it again.
