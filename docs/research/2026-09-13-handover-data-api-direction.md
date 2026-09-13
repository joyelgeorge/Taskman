# Handover: Data-API Business Direction (from ideation session)

## Constraint that shapes everything
- Solo builder, laptop + cloud only, works alone all day
- Explicitly does NOT want human interaction — no client calls, no sales calls, no support relationships
- This is why software engineering appealed in the first place — preference for automated, self-serve businesses over relationship-driven ones

## Where we landed: Option 4 — Data/API products
Core mechanic: scrape or aggregate data that's public but annoying to collect/normalize, sort it, find patterns via DB queries, and sell access via a metered/self-serve API (Stripe-gated). Buyers are developers/companies who'd rather pay per call than build their own pipeline.

### Candidate data directions discussed (not yet chosen)
**A. Price/availability tracking API**
- Track prices/stock across e-commerce or quick-commerce apps (Blinkit, Zepto, Instamart, Amazon, Flipkart) — these change hourly, no public API
- Sell to developers building price-comparison tools, deal-alert apps, resellers
- Risk: ToS/scraping fragility, sites change HTML constantly — real maintenance burden, not zero-touch

**B. Aggregated public-sector/regulatory data**
- Indian govt data (MCA company registrations, GST registration status, court records, land records) is public but unusable (PDFs, broken portals)
- Buyers: fintechs, lenders, legal-tech, due-diligence tools
- Proven demand — Signzy, Karza/PerFios, Setu already do this; the opportunity is a narrower slice they don't cover well

**C. Social/sentiment/trend aggregation for a niche**
- Pull public data (Reddit, YouTube comments, app store reviews) for one niche — e.g. stock/crypto sentiment, or feature requests across competitor app reviews in one category
- Sell structured trend data to founders/investors/product teams

**D. Domain-specific structured data nobody aggregates well**
- Examples raised: real-time LLM API pricing/rate-limit tracking across providers, shipping/courier rate comparisons, de-duplicated rental listing data for one city

### Honest reality check on "zero human interaction"
- Building the scraper/pipeline: fully solo, fits the constraint
- Getting first customers: even self-serve, some minimal outbound (posting on Reddit/HN/Twitter announcing the API) is the realistic minimum — not sales calls, but not literally zero either
- Ongoing maintenance (scrapers breaking when sites change HTML) is engineering work, not conversation — still fits

## Adjacent ideas explored earlier in the session (parked, not active)
These were generated while narrowing down to Option 4 — kept here for reference, not being pursued right now:
- "Silent Renegotiation" agent — auto-renegotiates B2B vendor/SaaS contracts, fee as % of savings (requires negotiation + human trust-building — conflicts with no-human-interaction constraint)
- "Idle Asset Interception" — finds wasted spend (unused cloud storage, expired SLA credits, etc.), contingency-fee model
- "Reverse Marketplace of Attention Debt" — machine-to-machine spot market for idle business capacity (two-sided marketplace, high bootstrap difficulty)
- "Cross-Stream Arbitrage Agent" — generalized engine finding money in gaps between two data streams a business owns but doesn't cross-reference
- Chartered-accountant distribution angle — sell reconciliation tooling through CAs (who already have client trust + data access) rather than direct to businesses
- Tally-specific reconciliation/shrinkage detector — has real access to a retailer's Tally DB folder; discussed using Tally's XML/HTTP interface (port 9000, default) or ODBC to pull Stock Summary + Sales Register and diff billed quantity vs stock movement to find shrinkage/theft/discount-drift. Trust-building sequence for this was worked out in detail (do analysis silently first, lead with one verifiable number, let shop owner verify in their own Tally, give first finding free, then pitch automation) — this remains available as a parallel wedge if the data-API direction stalls, since it's the one place with real, already-available data access.

## Reality check flagged mid-session
Across roughly an hour, 8-9 distinct business ideas were generated and each abandoned when a sharper one appeared. The actual risk to Taskman succeeding isn't idea quality — it's this pattern of never running one far enough to get a real data point. The recommended discipline going forward: pick one direction, ship a testable v1, and get at least one real signal (a paying customer, a verified number, a working pipeline) before generating the next idea.

## Suggested immediate next step (not yet started)
Pick ONE of the four data directions (A-D above) based on which domain is already familiar enough to know exactly which data is "annoying but valuable" to collect. Build a narrow v1 scraper/aggregator for that one slice, stand up a simple metered API (Stripe for billing), and get it in front of even a handful of potential users via a single async channel (e.g. one Reddit/HN post) — before evolving further or adding more data sources.
