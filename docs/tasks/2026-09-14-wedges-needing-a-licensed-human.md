# Parked wedge class: anything whose INTERVENE step needs a licensed human

**Status: backlog, with a stated revisit condition.** Raised 2026-09-14
(`taskman-repo-tasks.pdf`, Task 8). This is a *kill note for a class*, recorded
so it is not rediscovered under a new name — the same job
`packages/core/territory/registry.js` does for lanes.

## The class

- healthcare billing / insurance claim-denial detection
- legal spend and outside-counsel invoice audits
- manufacturing scrap and yield-loss detection
- construction cost-overrun auditing

Each has a large, real, well-documented leakage problem. That is what makes them
attractive and it is not the binding constraint.

## Why they are parked

They fail the test that matters: **can the AI actually fulfil it?** Detection is
tractable in all four. The INTERVENE step is not — appealing a claim denial,
challenging counsel's bill, acting on a yield finding on a real line, disputing
a construction variation each require a licensed or domain-expert human to act,
and that human has to be retained, managed and paid.

That reintroduces exactly the client-relationship and delivery overhead this
project is structured to avoid. A wedge where the expensive step is a
professional's time is a consultancy with a detector attached, and nobody here
is staffed to run one.

## Revisit condition

Only once Taskman has revenue funding a different structure — meaning people,
not more code. Recorded here so that the next discovery run proposing
"healthcare claim denials, huge market" meets the reason it was declined rather
than the attraction that keeps proposing it.
