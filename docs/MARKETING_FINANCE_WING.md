# The Marketing & Finance Wing

_Designed 2026-09-03. Extends `TARGET_DESIGN.md` and `AUTONOMOUS_SYSTEM.md`; does
not replace either._

## 1. The actual gap

Everything built so far collects, scores, executes, and settles. Walk the
pipeline end to end and notice what it never does: it never finds a specific
human or business who would pay for anything, and it never tells anyone what
the resulting numbers actually mean. `rail_economics` reports attempts, spend,
cleared, net, ROI — real, ledger-derived, correct — but that is arithmetic, not
a decision. Nobody reads it and learns what to charge, whether a rail is worth
another week, or who to talk to next. That absence is "the marketing economics
and finance team is not strong," named precisely: two organizational functions
this system has never had, because nothing in it was ever asked to have them.

## 2. What this is not — stated before the design, not after

**Not paid acquisition.** No rail has cleared a single verified settlement yet.
Spending on ads before a mechanism is proven violates the exact discipline that
produced the $50 probation budget in the first place — see `TARGET_DESIGN.md`
§11, Phase 6. This wing does not buy attention. It finds specific leads for free,
from public information, the same way a drone finds a signal.

**Not an autosend system.** Nothing designed here holds email, SMS, or social
credentials, and nothing here transmits a message to another person. Drafting a
message is automatable; sending one is a human action, every time, with no
exception — sending a message on someone's behalf requires their explicit,
per-action permission, and an autonomous system cannot supply that permission
for itself. A `SENT` status in this design means a human sent it themselves and
told the system afterward, not that the system sent it.

**Not accounting software as a product.** Bookkeeping-as-a-service was one of
the three lanes tested by hand (`docs/SYSTEM_DESIGN.md` §9 in spirit — the
conversation that produced the satellite scanner). This section is about
Taskman's own books, not a rail. The two ideas are unrelated even though the
words overlap.

## 3. The finance wing

### 3.1 What's missing

- No operational cost exists outside `rail_attempts.cost_cents` — hosting, paid
  APIs, anything not tied to one execution attempt has nowhere to live.
- No margin view. `rail_economics.roi` is `cleared / spend` for one rail; nobody
  computes contribution margin, burn rate, or how long a fixed budget lasts at
  the current burn.
- No projection. "At the current settlement rate, what does next month look
  like" has no answer anywhere in the system.
- No pricing signal. A rail that clears $30 per settlement after $22 of
  attempt cost is a very different rail from one that clears $30 after $2 — the
  ledger has both numbers today and reports neither difference.

### 3.2 Design

`packages/core/finance/` — deterministic only. Money math must never touch a
model; every number here is arithmetic over rows that already exist.

```text
expenses table          operational cost not tied to one rail attempt —
  (new)                 hosting, a paid API, a tool subscription. Tagged by
                         category ('infra' | 'marketing' | 'tooling' | 'other')
                         and optionally by campaign_key (§4.5) so marketing
                         spend rolls into the same report without a separate
                         accounting path.

report.js                pure functions over rail_attempts + settlements +
  (new)                  expenses:
                          - grossClearedCents, totalSpendCents (attempts+expenses)
                          - netCents, marginPct
                          - burnRateCentsPerDay (trailing N days, default 30)
                          - runwayDays (remaining global budget / burn rate,
                            null if burn is zero or budget is uncapped)
                          - perRail: contribution margin, cleared-per-attempt
                          - projection: trailing-N-day average extrapolated
                            forward, explicitly labeled as a naive linear
                            projection, not a forecast — this system does not
                            get to pretend precision it doesn't have

finance-report cron       OPTIONAL, ticketed not required for v1: a daily
  (ticketed)              snapshot into finance_report_history so the
                           dashboard can plot a trend line, not just today's
                           number. report.js works without it.
```

API: `GET /api/finance/report` (computed live), `GET /api/finance/report/history`
(once the snapshot cron exists). Dashboard: a Finance section — net position,
burn rate, runway, a per-rail margin table.

## 4. The marketing wing

### 4.1 What "marketing" honestly means at zero proven revenue

Not campaigns, not brand, not content calendars. At this stage marketing means
exactly one thing: finding the first specific person or business who would pay,
once, by hand — the same discipline `TARGET_DESIGN.md` §11 already names for
Phase 6. Software's job is to make finding that person and preparing to talk to
them fast. It is not to replace the human decision to actually talk to them.

### 4.2 The pipeline

```text
  lead drone           →   leads table   →   outreach-draft transform
  (deterministic,           (candidate        (LLM, schema + deterministic
   reuses packages/          buyer records,     post-condition — same
   core/drones)              not content        pattern as
                             items)              adversarial-validation.js /
                                                  execution-plan.js)
                                                        │
                                                        ▼
                                          outreach_drafts table
                                          status: READY_FOR_REVIEW
                                                        │
                                          a human reviews, edits,
                                          and sends it THEMSELVES,
                                          outside this system
                                                        │
                                                        ▼
                                          human marks it SENT, then later
                                          REPLIED / DECLINED / CONVERTED
                                                        │
                                          CONVERTED feeds the finance
                                          report as a real acquisition,
                                          via an expenses row tagged to
                                          the campaign that sourced it
```

### 4.3 Lead drones are drones, aimed at people instead of content

A lead source is read the same way a signal source is — `http_json`, `rss`, or
`page_watch` against a public directory (a permit registry, a business filing
list, a public forum). The difference is only what the result normalizes into:
a `leads` row (a named entity that might buy something) instead of a `signals`
row (a piece of content that might be worth acting on). `packages/core/drones`
is reused unchanged; `packages/core/marketing/lead-drones.js` is a thin adapter
that calls the same collectors and writes to a different table.

### 4.4 The outreach-draft transform — the load-bearing safety piece

Same family as `src/transforms/adversarial-validation.js` and
`execution-plan.js`: a model call wrapped in a deterministic post-condition that
JSON-schema validation alone cannot express.

Input: one lead + one campaign (a value proposition and its supporting
evidence — for example, the unclaimed-property campaign's evidence is literally
"$8.45B held in California alone; almost nobody checks more than one state,"
which is real data this conversation already gathered, not invented copy).

Post-condition, checked before a draft is ever stored as reviewable:

- **No fabricated number.** Any dollar figure in the draft must appear verbatim
  in the lead record or the campaign's evidence. A draft cannot claim "we found
  $50,000 owed to you" out of nothing — that would be fraud, not marketing, and
  the post-condition makes it structurally impossible to store, the same way
  `adversarial-validation.js` makes a fabricated evidence citation impossible to
  store.
- **No impersonation or false relationship claim.** Rejects language implying
  a prior relationship, authority, or affiliation that the campaign record
  doesn't declare.
- **Sourcing is disclosed in plain language.** The draft must state, in terms a
  recipient would understand, how they were found — no message goes out (even
  by human hand) pretending the contact wasn't sourced from public records.
- **An opt-out or decline path is present.**

A draft that fails the post-condition is discarded, never repaired — identical
discipline to the other two transforms.

### 4.5 Campaigns get the same falsifiability rails already have

A `campaigns` row is one lane + one value proposition + a status (`SCOPING`,
`ACTIVE`, `PAUSED`, `KILLED`). It carries a probation budget exactly like a
rail's — the cost of its drone runs and transform calls — and a campaign that
produces zero conversions after its budget is spent gets marked `KILLED`
automatically, the same kill-switch philosophy `rail-governor.js` already
applies to money rails, applied here to lead-generation spend. The ledger is
the loop (`TARGET_DESIGN.md` §4); this extends the loop one step earlier, to
before a rail even has a candidate to attempt.

### 4.6 What's seeded now, and what isn't

Zero real campaigns ship with this design. Inventing one would repeat the exact
mistake this document opens by naming — infrastructure built for a business
that doesn't exist yet. The three lanes already tested by hand
(`docs/AUTONOMOUS_SYSTEM.md`'s satellite-scan section) are real candidates; which
one becomes campaign #1 is the one decision this design deliberately leaves to
a human, not because the system can't compute a suggestion, but because it
already computed one wrong once this session and the fix was letting a human
decide.

## 5. Where finance and marketing meet

A campaign's drone-run and transform-call costs are written as `expenses` rows
tagged with `category: 'marketing'` and `campaign_key`, through the same
mechanism a rail attempt's cost already uses. Finance's report therefore
includes marketing spend without a second accounting path. Once a real
conversion exists: `CAC = campaign expenses / conversions`, and cleared
settlements attributable to that campaign's leads are its LTV-so-far — the
actual "marketing economics" named in the request that started this document,
and the number stays honestly `null`/"no data yet" until a real campaign
produces a real conversion, never estimated in its place.

## 6. What ships now, what's ticketed

**Built in this pass:** the finance module — `expenses` table, `report.js`, the
API, the dashboard section. No lane dependency, immediately useful against data
that already exists, zero risk of touching messaging or sending.

**Designed in full here, ticketed as repo issues, not built yet:** the
marketing module — `leads`, `campaigns`, `outreach_drafts`, the outreach-draft
transform, lead drones, the human-gated review/send dashboard. Building the
send-adjacent parts before a lane is chosen means building a pipeline with
nothing real running through it — exactly the trap this document names in §2.
The framework is fully specified so that once a lane is picked, standing up
campaign #1 is a config change and one API call, not a new design.
