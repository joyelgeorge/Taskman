# Data/API directions A–D: research verdict

Researched 2026-09-13 against the handover in
`2026-09-13-handover-data-api-direction.md`, which proposed four candidate
data/API businesses and asked for a demand pass on each.

**The four directions were researched. Three are already commodities and one is
licence-gated. The interesting result is not any of the four — it is what the
pattern of their failure says, in section 3.**

Answering the READ-FIRST question up front: **this document produces no
settlement row.** It is a demand-validation pass, which is the step the repo's
own post-mortem says was skipped before every previous build. It is worth doing
and it is zero dollars. Both are true.

---

## 1. The four directions, measured

### A. Price/availability tracking API — **DEAD, commodity**

Already sold, per request, by many vendors:

- OpenWeb Ninja: **$0.005/request**, pay-as-you-go, no subscription, free tier.
- Scavio: **$0.005/credit** across Amazon, Walmart, Google Shopping.
- Apify actors: $1.50 per 1,000 results (Amazon), $2.50–$4.00 per 1,000
  (Walmart, eBay).

The handover already flagged the maintenance burden (sites change HTML). The
research adds the part that actually kills it: that burden is real *and* the
price has already collapsed to half a cent. You would inherit the maintenance
without the margin.

### B. Indian public-sector / regulatory data — **REAL MARGIN, CLOSED DOOR**

The only direction of the four with no visible price floor. Karza, Signzy,
Perfios, Setu and the GSTIN comparison sites all quote **custom / usage-based
enterprise pricing** rather than a public per-call rate — the signature of a
market where sellers have pricing power.

They have pricing power because the barrier is not code:

- NBFC-AA (Account Aggregator) entities are **licensed directly by the RBI** and
  are barred from operating any business other than consent management.
- Entry requires API schema conformance, financial-information schema
  conformance, security-spec compliance and a test plan.
- Banks are under **no Indian legal obligation** to offer free or
  non-discriminatory API access — unlike PSD2 in the EU. Restrictive terms and
  API fees function as deliberate entry barriers.

So the barrier is a licence and a set of commercial relationships. A solo
builder with a laptop cannot code their way in. The moat is real, and it is
pointed at you.

Residual opening, unvalidated: the *unlicensed* public slice (MCA filings,
court records, land records) that needs no AA licence — only patience with bad
PDFs. Incumbents under-serve it because it is small. That is a genuine niche
and it is also a research project, not a week.

### C. Social/sentiment/review aggregation — **DEAD, commodity**

The exact product is on the shelf, repeatedly:

- App Store Review Miner — "AI-powered insights: top complaints, feature
  requests, sentiment trends, competitive comparison."
- Competitor Review Intelligence API — "mines low-star reviews into scored
  product pain points and grouped app opportunity ideas."
- App Store Competitor Review Gap Finder — "finds high-demand App Store
  competitors with recurring complaints, feature requests, and product gaps."

Price: **$0.20 per 1,000 reviews collected, plus $0.05 per analysis.**

That is not a market with a gap. That is a market with a listings page.

### D. Domain-specific structured data — **DEAD, commodity (worst case)**

The handover's own headline example — real-time LLM API pricing and rate-limit
tracking across providers — exists at least **four times over on one platform**:
OpenRouter Models Tracker, LLM API Price Tracker (with change alerts),
OpenRouter Models Scraper, OpenRouter LLM Pricing Data API.

One of them is **free and keyless**. The underlying data is also published by
OpenRouter itself as a public models endpoint.

This is the sharpest single datapoint in the research: the idea that felt most
"nobody aggregates this well" was the one most thoroughly already built, and
competing against free.

### Scoreboard

| | Barrier type | Price floor found | Open to a solo builder? |
|---|---|---|---|
| A Price tracking | Code | $0.005/req | No — commodity |
| B Indian regulatory | **Licence** | None public (enterprise) | No — RBI-gated |
| C Review/sentiment | Code | $0.20/1k reviews | No — commodity |
| D LLM pricing etc. | Code | **Free** | No — competing with free |

---

## 2. Why all four failed the same way

Three of the four were *code-barrier* businesses. One was a *rights-barrier*
business. That distinction explains the entire table.

> **When AI collapses the cost of building supply, price falls to marginal cost
> everywhere the only barrier was the building. The margin survives exclusively
> where the barrier is a right of access — a licence, a relationship, a
> contract, a dataset someone must let you have.**

The marketplace arithmetic shows the collapse in progress. Apify:

- **53,954 tools** listed.
- **~$1.4M paid monthly across ~3,000 developers → ~$470/month average**, and
  that average includes a long tail earning nothing.
- Top independent creators clear $10k/month; one developer shipped **98 actors
  in six months**.

53,954 tools is not a marketplace, it is a sediment layer. 98 actors in six
months is what one person's supply capacity now looks like. The scarce thing is
visibly no longer the artifact.

This is the same finding the repo already made, one level up. `CLAUDE.md` says
Taskman "built enormous SUPPLY and never validated DEMAND." The research says
that is not a Taskman defect — it is now the default failure mode of every solo
builder with a capable model, and the marketplaces are full of the wreckage.

It also validates the existing direction by contrast. Vibe-coded-app security
pays because the barrier there is not building a scanner (trivial) — it is
that someone must *let you* touch their app and *trust* the fix. That is a
rights-and-trust barrier. It is why the Fiverr $80–125 fix gig holds its price
while the scanners race to $5/mo.

**Direct consequence for direction-picking:** stop scoring ideas by "is this
annoying to collect." Every remaining annoying thing is worth $0.005. Score them
by "what do I have permission to touch that others do not." Against that test,
the single strongest asset named anywhere in the handover is the parked one:
**live access to a real retailer's Tally database.** That is a rights barrier
the builder already holds, and it was set aside in favour of four code-barrier
ideas that the market had already priced at zero.

---

## 3. The possibility that does not exist yet

Everything above is analysis of things that exist. This section is not; treat
it accordingly — it is a hypothesis with a named cheapest test, not a plan.

### The asymmetry nobody has priced

Building used to be the expensive step, so experiments were few and each one was
carefully chosen. That has inverted. Building is now hours. **Validation — the
weeks of finding out whether anyone actually pays — did not get faster at all.**
It is still bounded by human attention, human replies, human money moving.

So the ratio between "experiments started" and "experiments concluded" has blown
open, and there is no infrastructure for the new bottleneck. Two things follow,
and the second has no precedent.

**First: nearly every experiment now ends without a verdict.** Not in failure —
failure is a result. It ends *abandoned*, when a sharper idea arrives. The
handover documents this happening nine times in one hour. This repository
documents it structurally: six code paths can record a settlement, **none has
ever been travelled.** The builder is not short of ideas or of capability. The
builder has never once reached the end of one.

**Second, and this is the part that has never existed: every negative verdict
ever produced is thrown away.** Someone spends three weeks establishing that
nobody pays for X, and that knowledge dies in their head. The next person starts
the identical experiment from zero. There is no registry of dead ideas, no price
on a negative result, no way to *buy the answer* instead of re-deriving it.

Science named this — the file-drawer problem — and treats unpublished negative
results as a serious, quantified cost. Entrepreneurship has the same problem at
vastly greater volume and **has not even named it.** Nobody has named it because
until this year the experiments were rare enough that the waste was tolerable.
At 53,954 actors and 98-per-developer supply rates, it no longer is.

### What the thing would be

Not an idea generator. Ideas are now the single most abundant substance on
earth; the handover produced nine in an hour and this repo can produce nine
more before lunch. Generating them is negative-value work.

The thing is a **verdict engine**: it takes exactly one idea and drives it to a
kill-or-continue data point under enforced discipline — and refuses to let the
next idea start until it does. Its output is not a product. Its output is an
answer, with evidence, about whether money exists there. The interesting claim
is that the answer has value *to other people* precisely when it is negative,
because a credible "no" is the thing everyone is about to spend three weeks
buying at full price.

That reframes "innovation agent creating entrepreneurs by Claude" into something
that is not fantasy. Claude is bad at the scarce thing if the scarce thing is
ideas — it is infinite at ideas, which is the problem. Claude is uniquely suited
if the scarce thing is **finishing**: running the tedious loop to completion,
without ego, without the dopamine hit that makes humans jump to idea ten.

### Why this repo is strange enough to be the right place

Taskman already contains most of the hard part, built by accident while aiming
at something else:

- `src/money-ledger.js` **refuses self-reported revenue by construction**
  (verified, not recalled): `VERIFIED_SOURCES` is frozen to
  stripe/paypal/bank/manual_receipt at `money-ledger.js:74`, and
  `money-ledger.js:213` throws on an empty `externalRef` with the reason stated
  outright — *"a settlement no external system can confirm is not money."*
  That is a verdict-certification primitive. It is the reason this repo can say
  "$0" and be believed.
- Kill criteria, lane states, and `docs/tasks/` already model "this was tried and
  here is what happened."
- `docs/READ-FIRST.md` is already an enforcement document against exactly the
  abandonment failure.

Someone built a machine for producing trustworthy verdicts about whether money
is real, while trying to build a machine for making money, and has been reading
its $0 output as failure. The $0 is the machine working.

### The honest problem with it

**Nobody has been shown to pay for a verdict.** That is unvalidated, and writing
this section is itself the tenth idea in the pattern the handover warns about.
It does not get built on the strength of being interesting.

The saving grace is that its first test costs nothing to run, because the
inventory already exists. This repo holds roughly nine documented dead lanes with
real evidence. So:

**Cheapest test, no build required:** write up the dead lanes as one honest
artefact — *"nine ways an AI agent tried to make money in 2026, what each cost,
and exactly where each one died, with evidence"* — publish it on one async
channel, and measure whether anyone asks to buy the next one, sponsors it, or
hires the person who wrote it.

Publishing costs a day. It uses the no-human-interaction constraint correctly.
Its failure mode is a day. And by construction it produces a *verdict* rather
than another idea — which makes it the first thing in this document that breaks
the pattern instead of extending it.

If nobody responds: the answer is no, record it, and it becomes the tenth entry
in the inventory. That outcome is still the system working.

---

## Recommendation

1. **Do not build A, C or D.** Priced at or near zero by live competitors.
2. **Do not chase B** unless deliberately taking on the unlicensed-PDF niche as a
   multi-month project with eyes open.
3. **Re-open the Tally wedge** if a data business is wanted, on the rights-barrier
   test. It is the only named asset with access that others lack.
4. **Run the day-long verdict test** before any further ideation. It is the
   cheapest real signal available and it is already paid for.
5. **Nothing here changes the active plan.** Vibe-coded-app security (#212–#217)
   survives this research strengthened, for the reason in section 2: it is a
   rights-and-trust barrier, not a code barrier.

## Sources

- [OpenWeb Ninja — best e-commerce APIs 2026](https://www.openwebninja.com/blog/best-ecommerce-apis-2026)
- [Scavio — best e-commerce price tracking API 2026](https://scavio.dev/best/best-ecommerce-price-tracking-api-2026)
- [Apify — Price Tracker API (TrueFetch)](https://apify.com/truefetch/price-tracker-api)
- [Perfios — top PAN verification API providers in India](https://perfios.ai/resources/blogs/top-10-pan-verification-api-providers-in-india/)
- [GST verification API providers compared, 2026](https://www.gstinapi.in/gst-verification-api-comparison)
- [HyperVerge — Account Aggregator framework (RBI), 2026 guide](https://hyperverge.co/blog/account-aggregator-framework-rbi/)
- [AMLEGALS — legal ownership, consent and market power in India's open banking](https://amlegals.com/banking-by-api-legal-ownership-consent-and-market-power-in-indias-open-banking-framework/)
- [BIS — API standards for data-sharing (account aggregator)](https://www.bis.org/publ/othp56.pdf)
- [Apify — App Store Review Miner](https://apify.com/automationnation/app-store-review-miner/api/mcp)
- [Apify — Competitor Review Intelligence API](https://apify.com/symphony_bots/competitor-review-intelligence/api)
- [Apify — App Store Competitor Review Gap Finder](https://apify.com/happyfhantum/appstore-competitive-gaps/api/cli)
- [Apify — OpenRouter Models Tracker](https://apify.com/cynix_dev/openrouter-models-tracker/api)
- [Apify — LLM API Price Tracker, change alerts](https://apify.com/kaz_kakyo/llm-price-alerts/api/openapi)
- [Apify — OpenRouter Models Scraper, free](https://apify.com/hichemdev/openrouter-models-scraper/api)
- [AgentByline — Apify actor passive income: what really earns in 2026](https://agentbyline.com/articles/apify-actor-passive-income-what-really-earns-in-2026-67lcfr)
- [Apify blog — building 98 actors in 6 months](https://blog.apify.com/building-98-actors-on-apify-store/)
- [Apify — actor developer partners](https://apify.com/partners/actor-developers)
