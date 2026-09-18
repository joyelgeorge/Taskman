---
status: open
priority: P1
level: 1
opened: 2026-09-18
---

# Cyber-insurance referral off real scan findings

Raised from a `/revenue-discovery` pass, 2026-09-18. Scored **0.73** —
second-highest of the new batch — but the score leans on an assumption worth
stating plainly: `distribution: relationship_exists` was scored on the premise
that this only fires **inside an already-warm disclosure conversation**
(vibe-app-security has sent one), not as its own cold channel. It is not a
standalone lane; it is additive revenue on top of one that already exists.

## The idea

The easternLM research finding (`docs/research/NOTES.md`, before the
uncommitted overwrite — real regardless, it's a live SHA in this repo's
history) quantified real exposure in insurance terms: NY SHIELD Act breach-cost
range $120K–$1.24M for a small business. A disclosure email that names a real
vulnerability could, in the same message or a fast follow-up, offer an intro
to a cyber-insurance broker for the risk that can't be fixed by Monday.

## Why P1 despite the caveat above

Cheapest possible test of any option opened today: the next real
vibe-app-security disclosure that goes out, ask one extra sentence. No build,
no new relationship needed on Taskman's side to test demand — only to fulfil
it if the answer is yes (a broker partnership, not built yet, `feasibility:
large_build` in the score).

## What's needed to fulfil (not to test)

1. A broker relationship — revenue share on referred/bound policies. Not
   something this repository can originate; a business development
   conversation the operator has, same category as the Tally retailer
   relationship or the Fiverr account.
2. Until #1 exists, the "test" is just measuring interest, not completing a
   referral — track it as a yes/no in the disclosure log, nothing more.

## Done looks like (for the test, not the full lane)

The next disclosure sent includes the offer; a reply either takes it or
doesn't; log which, either way — a "no" is data, not a failure, per
`taskman-verify`.
