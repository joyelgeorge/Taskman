# The data ecosystem

_Designed 2026-09-03. Companion to `AUTONOMOUS_SYSTEM.md` and
`MARKETING_FINANCE_WING.md`._

## 1. "Data is money" — the part that is true, and the part that isn't

The premise behind this subsystem is that accumulated data becomes an asset.
That is true of a narrow slice of data and false of most of it, and building
the wrong slice is expensive in exactly the way this project has been burned
before — infrastructure that grows while nothing earns.

**What has no value:** a scraped copy of a public page. Anyone can fetch it, it
is a commodity the moment it exists, it has no buyer, and it costs storage and
maintenance forever. A database full of today's public data is a liability with
a hosting bill.

**What has real value — three kinds, and only three:**

1. **History nobody else kept.** Anyone can scrape today's number. Almost
   nobody keeps a clean daily series of it for two years. The scrape is
   worthless; the *time series* is not, and it compounds daily at near-zero
   marginal cost. This is the only kind of data asset a solo operator can
   realistically build from public sources.
2. **Your own operational record.** Every drone run, scan verdict, order,
   settlement and governor decision this system has made. Genuinely
   proprietary — nobody else has it, it cannot be scraped, and it is what makes
   the scoring and pricing decisions get better instead of staying guesses.
3. **Data joined to a decision.** A number that changes what someone does is
   worth something; the same number sitting in a table is not.

Everything below is built for those three and deliberately not for volume.
Collecting more is not the goal, and a bigger database is not progress.

## 2. CEO view — where this actually touches money

Being honest about magnitude, because "data is money" invites overestimating:

| Series | Decision it changes | Honest value |
|---|---|---|
| USD→INR daily rate | What a $20 gig is actually worth after conversion; whether to hold or convert payouts | **Real and immediate.** A 3% move on every settlement is pure margin, and payouts land in USD while costs are in INR |
| Own order history (price, minutes, payout) | Pricing, and whether the Fiverr lane survives its own hourly-rate test | **The highest-value series here.** Already being collected (#135) |
| Own scan history (venue reachability over time) | Whether a blocked venue ever opens up; when to retry a lane | Real, small, cheap |
| Own signal→conversion history | Which keyword rules actually predict something, replacing guessed thresholds with measured base rates | Real, but only after volume exists |
| Public holiday calendars | When buyers are inactive; delivery-time promises | Marginal. Included because it is one call a year, not because it matters much |

Notice what is absent: no competitor price scraping (Fiverr is bot-defended, we
measured it), no lead/contact harvesting (personal data, real legal exposure,
and the marketing wing is deliberately parked), no bulk scraping of anything a
robots.txt asks us not to take.

**The strategic point:** the only genuinely defensible dataset here is the
operational one — and it only exists if the system keeps running. Which makes
data accumulation an argument for shipping the money lane, not a substitute
for it.

## 3. Developer view — architecture

### 3.1 Hot and cold, because free storage is the binding constraint

Neon's free tier is 0.5 GB. A daily time series will eventually exceed it, so
retention is designed in from the first row rather than discovered later.

```text
   collectors (deterministic, robots-aware, official APIs preferred)
        │
        ▼
   observations          HOT — raw rows, indexed, queried by crons.
                          Retained ~90 days, then pruned after rollup.
        │
        ├──► observation_rollups   WARM — daily min/max/avg/count per series.
        │                           ~200 bytes/series/day. Kept indefinitely:
        │                           1 series × 10 years ≈ 700 KB. This is the
        │                           part that is actually the asset.
        │
        └──► cold archive          COLD — append-only JSONL, one file per
                                    series per month, committed to a separate
                                    git repo and/or attached to a GitHub
                                    Release. Free, versioned, unlimited in
                                    practice, and readable by anyone with the
                                    URL. Ticketed, not built (§5).
```

The rollup is the trick that makes "free forever" real. Raw rows are the
expensive part and the least valuable; the daily aggregate is ~1/100th the size
and is what any downstream question actually needs. Pruning raw data after 90
days is not a compromise — it is the design.

### 3.2 Why git is a legitimate cold store

GitHub hosts public repos free with no storage bill, and a repo of append-only
JSONL is versioned, diffable, and permanently addressable. This is a known
pattern (git scraping) and it fits the stated constraint of no subscriptions
exactly. Limits worth knowing before relying on it: repos are soft-capped
around 1 GB (5 GB hard), individual files should stay under 50 MB, and Release
assets allow 2 GB per file with no total cap — so monthly-partitioned files and
Releases for anything large. A separate repo keeps this history out of the
code repo, whose clone time should not grow with data.

### 3.3 Collection rules, enforced in code not just documented

- **Official API over scraping**, always, where one exists.
- **robots.txt is checked and obeyed** before any non-API fetch, and a
  disallowed path is recorded as a refusal, not retried.
- **Bot-defended venues are not scraped.** The satellite scanner already
  detects these; a defended target is excluded rather than worked around.
- **No personal data.** No names, contacts, or anything identifying a person.
  This is a hard line: it removes the entire class of GDPR/CCPA exposure that
  makes scraped-data projects legally expensive, and none of the value in §2
  requires it.
- **Licence recorded per source.** A series whose licence is unknown is not
  collected.
- **One polite request per source per interval**, same discipline as the
  satellite scanner.

### 3.4 How existing crons consume it

The point of the store is to be read, not to accumulate. Concretely:

- `financeReport()` can convert cleared USD settlements at the *observed rate
  on the settlement date* rather than today's, which is the difference between
  a real margin number and an approximate one.
- `signal-process` scoring thresholds, currently hand-set constants, can be
  replaced by measured base rates once enough signal→outcome history exists.
- `improve` gains a real evidence base: proposals grounded in observed trends
  instead of only current-state snapshots.

None of these are speculative extensions — they are the reason the store exists,
and each is a ticketed follow-up rather than a promise.

## 4. What ships now

`observation_sources` and `observations` tables, a deterministic collector with
robots.txt checking, daily rollups, retention pruning, an eighth cron
(`data-collect`), API and dashboard surface. Seeded with the ECB euro reference
rates — an official, free, explicitly-reusable feed that yields USD/INR, the
one series in §2 with immediate margin impact.

## 5. What is ticketed, not built

- Cold archive to git/Releases, with the monthly-partition layout above
- FX-aware settlement conversion in `financeReport()`
- Measured base rates replacing hand-set `signal-process` thresholds
- Additional series, added only when a specific decision needs one

The rule for adding a source: **name the decision it changes before adding it.**
A series that answers no question is storage cost with extra steps.
