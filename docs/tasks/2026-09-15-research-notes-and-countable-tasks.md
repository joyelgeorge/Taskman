# Make research and tasks accumulate instead of evaporating

**Priority: P2. Phase 1 of the accumulating-architecture spec. Progress level 4.**
Raised 2026-09-15.

## What

Two stores that turn a session's output into something the next session can find.

**`research_notes`** — a table plus a `docs/research/` mirror so git holds it
too. Each note carries the claim, its evidence tier from `src/evidence-tier.js`,
the source that backs it (a URL, a command and its output, a file and line), and
when it was recorded. **A research pass that produces no note produced nothing.**

**Countable tasks.** `docs/tasks/*.md` gain YAML front-matter — id, status,
priority, opened, closed, progress level — so `docs/tasks/README.md` is generated
rather than hand-maintained, and `brief` can count open and closed work. The
prose body does not change; it is the part a human reads, and it is the reason
these files work.

## Why it matters

The vibe-app sweep wrote its results to `/tmp` and lost them. That is the whole
argument. Findings that live only in a transcript die with it, and the next
session pays to rediscover them — or worse, half-remembers one and states it as
fact.

Hand-maintaining the index also has a failure mode the README itself warns
about: *"a parked task that is silently done is a task someone will do twice."*

## Why it is not done now

It is downstream of Phase 0. A store that accumulates notes is worth less than a
command that stops a session believing a false zero, and both want the same
`verified / empty / unknown` vocabulary — defined once, in Phase 0.

## Done looks like

A finding from a past session is retrievable without its transcript, and the task
index is generated from the task files rather than typed alongside them.
