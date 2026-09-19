# Operator guards

Everything else in this repository protects the lanes from the market: trap
listings, lying detectors, unverified leads, charges without verification. This
document is about protecting the lanes from **the operator** — the patterns the
stores themselves recorded while settlements stayed at zero.

It is written for two readers. The operator, who agreed to these guards on
2026-09-16. And any session, which should treat them the way it treats the
bounty-triage gates: not optional, and not something to reason around because a
new idea looks unusually good. Every new idea looks unusually good.

## The pattern, from the stores (2026-09-16)

- `income_streams`: four machine-only lanes TESTING, four human-unblocked lanes
  BLOCKED, one DISPROVEN, zero with a `first_settled_at`.
- The lane the table itself calls "the shortest distance between the system and a
  first settlement" (`payout-audit-direct`) was blocked on creating a payment
  account, estimated at one hour, for eleven days.
- Three of the four TESTING lanes (DePIN bandwidth, DeFi flashloans, GPU
  inference) were added in one batch on 2026-09-06, the day after the human lanes
  were marked BLOCKED.
- Outside this repository, the same fortnight held a Section 8 company plan, an
  India–Bhutan trade backlog, and a small bitcoin trading idea — roughly thirty
  distinct lanes across the operator's work in total.
- `signals` 4,853 rows, `cron_runs` 411, `outreach_attempts` 2, `settlements` 0.

None of this is a capability problem. The code path to the first dollar exists.
The constraint is which work gets chosen when the next step needs a person.

## Weakness → evidence → guard

### 1. Opening a new lane when the current one needs a human step

**Evidence.** Procrastination research treats avoidance of an aversive task as
short-term mood repair: switching to something that feels good now, with the
cost borne later (Sirois & Pychyl, 2013). For a builder, the thing that feels
good now is building. A new lane is procrastination that looks like progress.
Annie Duke's "monkeys and pedestals" names the same trap in project terms:
people build the easy pedestal instead of training the monkey, which is the hard
part that decides whether the project works (Duke, *Quit*, 2022).

**Guard.** `human-step-debt` filter. A cheap human step (≤ 3h) waiting more than
2 days on a committed lane parks every new lane, and the verdict names the step.
Overdue commitment criteria count too. `npm run next` prints them at session
start.

### 2. Too many concurrent lanes

**Evidence.** Gerald Weinberg's project-switching table (*Quality Software
Management*, Vol. 1, 1991) estimates that a second concurrent project costs about
20% of total effort, with steeper losses after. These are engineering heuristics
rather than laboratory results, and later work suggests the loss is smaller and
less linear than the table implies. The direction is not in dispute, and eight
concurrent lanes is far outside any range where it is small.

**Guard.** `wip-limit` filter and `laneLoad()`: one primary lane (needs the
operator), one background lane (accrues alone). A new lane takes a slot only by
replacing one marked DISPROVEN with evidence.

### 3. No exit condition, so lanes never end

**Evidence.** Duke recommends kill criteria set in advance as a state plus a
date: if by this date I have not reached this state, I quit. Pre-committing to
the exit is what makes people follow through when sunk cost and optimism argue
for one more week.

**Guard.** `kill-criteria` filter rejects any proposal without a future
state-and-date exit. `validateCommitment()` rejects a commitment whose criteria
lack an `ifMissed` consequence, because a criterion with no consequence is a
wish.

### 4. Building supply before demand

**Evidence.** The Startup Genome Project's study of over 3,200 startups found
that about 74% of high-growth internet startups that failed did so through
premature scaling — building and expanding ahead of validated demand. This repo
reached the same conclusion on its own on 2026-09-08 (`CLAUDE.md`, critical
strategic finding).

**Guard.** `paying-demand` filter parks any lane that cannot name evidence of
someone already paying for the thing.

### 5. Automating distribution before the first customers

**Evidence.** Paul Graham's "Do Things That Don't Scale" (2013) argues that nearly
every startup has to recruit its first users by hand, and that the usual reasons
founders skip it are shyness and preferring to build. This does not contradict a
solo, self-serve business. It means the ignition is manual even when the engine
is not.

**Guard.** The `solo-fit` filter separates two things the operator's goal
conflates. One-time ignition work — a launch post, a KYC form, answering a reply —
is expected and required. Lanes that *run on* recurring relationships (co-
directors, CSR committees, partner meetings) are parked unless explicitly
overridden, because they contradict the stated operating goal rather than
starting it.

### 6. Knowing the plan and not doing it

**Evidence.** Gollwitzer & Sheeran's 2006 meta-analysis of 94 studies found that
if-then plans ("if situation X, then I do Y") produce a medium-to-large
improvement in goal attainment (d = 0.65) over holding the goal alone, with the
largest effects on discrete, one-off actions and on getting started at all.
Every blocked human step in this repository is a discrete, one-off action.

**Guard.** `data/operator-commitment.json` requires `ifThen` plans, each with a
cue, an action, and a size in minutes. `validateCommitment()` rejects a plan with
no size, because a plan with no size never starts.

### 7. Capital-at-risk lanes beside zero-capital ones

**Evidence.** SEBI's FY25 study of about 9.6 million individual equity F&O
traders found that roughly 91% lost money, with net losses around ₹1.06 lakh
crore. The loss ratio has stayed between 89% and 93% since FY22 despite
regulatory changes. Crypto and DeFi lanes are not the same market, but a solo
newcomer competing against bots and professional desks has no identified edge in
either.

**Guard.** `capital-risk` filter detects trading, crypto, DeFi and similar lanes
from their text. Uncapped: rejected. Capped: parked as a sandbox, never the
primary lane, never during an active commitment. This is a filter on the
operator's own task board, not financial advice.

## How the pieces fit

| Piece | Role |
| --- | --- |
| `src/operator-guards.js` | Pure, deterministic filters. No database, no clock but the one passed in. |
| `data/operator-commitment.json` | The one committed lane, its kill criteria, its if-then plans. |
| `scripts/guard.mjs` | `npm run guard` prints the position; `npm run guard -- lane <file>` runs a proposal through the filters. |
| `scripts/next.mjs` | Prints the commitment block at every session start. |
| `docs/operator/parking-lot.md` | Where parked ideas go. One line each, no research until review. |
| `.claude/skills/new-lane-intake-filter` | Makes a session run the filter before any new lane gets code, tasks or rows. |
| `.claude/skills/clearing-human-step-debt` | Makes a session shrink a human step into something doable today, then wait. |
| `test/operator-guards.test.js` | Every filter proven by mutation, plus a guard on the real commitment file. |

## What this is not

It is not a verdict on the operator's ability; the stores show the opposite.
The limits are defaults, not laws of nature: change them in the commitment file
with a reason, the same way a detector threshold is changed. What should not
change is that the reason gets written down before the limit moves, not after.

## Sources

- SEBI FY25 equity derivatives study, as reported by Business Standard (2025-07-07) and MoneyLife (2025-12-15); SEBI press release on FY22–FY24 losses (2024-09).
- Startup Genome Project, *Startup Genome Report Extra on Premature Scaling* (2011, v1.2 2012).
- Gerald M. Weinberg, *Quality Software Management, Vol. 1: Systems Thinking* (Dorset House, 1991), project-switching table.
- Peter Gollwitzer & Paschal Sheeran, "Implementation Intentions and Goal Achievement: A Meta-Analysis of Effects and Processes," *Advances in Experimental Social Psychology* 38 (2006).
- Fuschia Sirois & Timothy Pychyl, "Procrastination and the Priority of Short-Term Mood Regulation," *Social and Personality Psychology Compass* 7(2) (2013).
- Annie Duke, *Quit: The Power of Knowing When to Walk Away* (Portfolio, 2022).
- Paul Graham, "Do Things That Don't Scale" (2013), paulgraham.com/ds.html.
