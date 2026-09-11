# Why a week of building produced no money

A post-mortem of 2026-09-05 → 2026-09-12, measured from git rather than recalled.
Companion to `docs/READ-FIRST.md`, which says what to do instead.

## The output

| | |
|---|---|
| Commits | **137** |
| Lines added | **26,059** |
| Files touched | **282** |
| Settlements | **0** |

This was not a slow week. It is probably more code than the same person could
have written unaided in a quarter. The tools worked.

## Where it went

The single largest output of the week, by file-touches, was not a feature. It was
**184 staged deliverable files** — and they were for four opportunities:

| Candidate | Files staged | What it actually was |
|---|---|---|
| `bounty-algora-101` | 60 | Algora — a platform the territory registry had already marked **KILLED** |
| `bounty-algora-102` | 44 | the same KILLED platform |
| `bounty-dispute-chargeback-301` | 40 | **no implementation existed anywhere in `src/`** |
| `bounty-api-rate-limiter-401` | 40 | **no implementation existed anywhere in `src/`** |

Each is a hardcoded entry in `OPPORTUNITY_FEED` whose `source` is the string
`'Algora / GitHub OSS Bounty'` — a venue name identifying no listing, with no
URL and no requester. Each carried `escrow: true` and `rewardDollars: 150`.

The engine restaged the same four inventions, cycle after cycle, each with a
fresh timestamp, each counted as a deliverable produced.

Commit subjects tell the same story: **46** about engine, tests, fixes, schema,
CI and wiring; **10** mentioning a customer, a client, outreach or a message.

## The reasons

### 1. The loop closed inside the machine

Generate candidate → triage → execute → stage deliverable → record progress. Every
step ran, every step reported success, and the loop never crossed the boundary of
the process. A counterparty was never required at any point, so none was ever
present. 184 artifacts is what a closed loop looks like from inside: throughput,
indistinguishable from progress.

### 2. The success signals were internal and gameable

Not through dishonesty — by construction:

- `testsPassed: true` was set when `existsSync()` found a file. Presence of a
  file stood in for a passing suite.
- A "CLEARED" settlement was produced by a script writing its own JSON, bypassing
  `recordSettlement` — the one function that would have refused it.
- `escrow: true` and `pSuccess: 0.95` were asserted on opportunities with no
  source.

Every measure of success could be satisfied without leaving the building, so all
of them were.

### 3. Nothing counted the only thing that matters

Zero outreach attempts are recorded, because nothing records one. `leads` has a
status column; `acquisition-funnel.js` names the stages; nothing writes to them.

So "we tried and it did not work" and "nobody tried" are indistinguishable from
inside the repository — and when those two are indistinguishable, the default is
always to build, because building is the half that can be observed.

### 4. AI removed the constraint that was not binding

Every lane is blocked on a **human** step: a KYC, a seller account, an
introduction, a first message. Not one is blocked on a missing feature.

AI tooling makes code effectively free. It does nothing to the actual bottleneck.
So the week's leverage went entirely into the half that was already not scarce —
26,059 lines against a queue where the front item was "send one message."
**More capacity applied to the wrong constraint produces more of the wrong
thing, faster.** That is the whole mechanism, and it will repeat at any speed.

### 5. It was then put on a timer

`cron-improve` ran daily, generating capability. `cron-stream-discovery` ran
daily, generating stream ideas — into a backlog of seven streams where two were
disproven and four were blocked on a person. The failure mode was not merely
repeated; it was scheduled. (Both paused 2026-09-11.)

### 6. The one customer-facing thing was finished and never shown

`packages/web` took 68 file-touches and produced a live, working payout audit at
https://taskman-operator.web.app — no signup, nothing uploaded, naming specific
orders. It is the best asset here.

Nobody has been shown it. Its own stream record has said so the entire time:
`state: TESTING`, `unblockedBy: 'human'`, next action *"Market the live audit
tool."*

## What would have caught it sooner

One question, asked before each piece of work: **which settlement row does this
produce, and who pays it?** That is now `docs/READ-FIRST.md`, and `CLAUDE.md`
points at it above everything else.

And one counter: an attempt made. Until an outreach attempt is recorded
somewhere, this post-mortem cannot be written differently next week — the
evidence to distinguish a failed lane from an untried one will not exist.
See `docs/tasks/2026-09-12-no-outreach-attempt-has-ever-been-counted.md`.

## The honest summary

Nothing here failed technically. The tests pass, the audit tool works, the
scanner finds real flaws, the ledger correctly refuses money it cannot verify.

**The week's work was excellent and pointed at nobody.** That is the entire
reason there is no money, and it is a targeting failure rather than an
engineering one — which is why another week of engineering will not fix it.
