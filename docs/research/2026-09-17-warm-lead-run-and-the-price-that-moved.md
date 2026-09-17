# The lead run that found no leads, and the price that moved

Run 2026-09-17. The instruction was to produce named leads with confirmed
findings — `READ-FIRST.md` progress level 3. **It produced none**, and in
failing it measured something that matters more: the price the whole wedge is
premised on is not the price the market is charging.

No settlement row here either. But unlike the rest of this week's work, this is
not supply — it is a demand check, and it came back negative.

---

## 1. The cold drone cannot run in a web session

`scripts/hunt-vibe-leads.mjs` is blocked here for two independent reasons, both
environmental rather than defects in it:

- **`gh` is not installed.** Candidate generation calls
  `gh api search/repositories`, so the sweep has no input.
- **Cloning third-party repos is refused.** `git clone` of an out-of-scope public
  repo fails with *"could not read Username for 'https://github.com'"*, while the
  same command against the in-scope repository succeeds. That is the session's
  repository scoping, an authorization boundary, not a glitch.

Not worked around, deliberately. Parked as
`docs/tasks/2026-09-17-lead-engine-cannot-run-in-a-web-session.md`.

## 2. The warm engine ran, and found nobody

`warm-lead-scout` is the repo's stated primary engine: find people who have
*already* asked for help. It searched Reddit, IndieHackers, Hacker News, dev.to,
Stack Overflow and Fiverr.

**Zero qualified warm leads.** Not one named individual asking for help securing
their app.

Two reasons, worth separating:

- **Reach.** Reddit and Stack Overflow — where the skill says the warmest intent
  lives — refuse the crawler outright. A browser could render them; that would be
  routing around a stated refusal, so it was not done. **The single highest-intent
  surface is simply not reachable from here.**
- **What came back instead.** Every result on the reachable surface was a
  *supplier*: content-marketing posts by people selling scanners, and Fiverr
  sellers advertising fixes. Searching for demand returned supply, repeatedly,
  across six differently-worded queries.

That second point is the finding. It is the same shape as the data/API research
on 2026-09-13: when a search for customers keeps returning competitors, the
market is telling you which side of it is crowded.

## 3. The price that moved

`CLAUDE.md` states the wedge directly:

> Proven paying: scanners at $5–29/mo, **Fiverr fix gigs $80–125**, dedicated
> shops (humansfix.ai). … **Wedge:** the scan-only niche is crowded. Compete on
> FIX + verified proof at the **Fiverr-proven $80–125**, not on being another
> free scanner.

Observed 2026-09-17, from live listing titles:

| Seller | Offer | Price |
|---|---|---|
| forcybertech002 | fix lovable deploy, supabase auth, stripe | **$10** |
| appdev_studiox | fix lovable/replit/firebase supabase app | **$10** |
| felicityquninn | fix, deploy, migrate lovable + supabase | **$20** |
| abrahamsamuel06 | nextjs/supabase, fix lovable deployment | **$25** |
| joshua_matth | rescue/fix lovable app, vibe code | **$30** |
| vedrixappz | fix/deploy lovable, replit, bolt, v0, cursor | **$30** |
| rahimahmad526 | fix/deploy lovable, replit, supabase, CI/CD | **$40** |

**Seven sellers, $10–40. Not one at $80–125.** The scanner tier holds where
CLAUDE.md says it does (Vibe App Scanner $5 / $14 / $29-mo), and the free tier has
arrived beneath it — SafeToShip does 60-second URL scans free, CheckVibe starts at
$0.

Meanwhile the top of the market went the other way: **theswarm.at charges €1,500**
for a Supabase RLS audit, credited toward the fix work, describing Lovable/Bolt/
Cursor apps as their most common case.

### What that shape means

The market has gone barbell: **free-to-$40 commodity scan-and-fix at one end,
four-figure professional audits at the other.** The $80–125 middle the wedge
aims at is precisely the part that has been hollowed out.

This is the 2026-09-13 finding again, from a third direction: where the only
barrier is doing the work, price falls to marginal cost — seven strangers on
Fiverr will do it for $10. Where the barrier is trust, price holds — theswarm is
a named firm with a credited engagement, and charges 37× the Fiverr top end for
recognisably the same technical task.

The competitor set is also no longer thin. Named in one search: Vibe App Scanner,
CheckVibe, SafeToShip, ZeriFlow, VibeEval, Scanbee, Aikido, ChakraView,
amihackable.dev, VibeCheck, Fortivibe, theswarm, axonbuild. CLAUDE.md's "the
scan-only niche is crowded" was right and is now an understatement.

## 4. What this does and does not disprove

**Does not disprove:** that the vulnerabilities are real and widespread. That
held up everywhere and got stronger — Symbiotic Security scanned 1,072
Supabase-backed vibe-coded apps in June 2026 and found **98% with at least one
issue, 16% critical**, which is the source of the 98% figure CLAUDE.md cites.
CVE-2025-48757 hit 170+ Lovable apps on exactly the RLS pattern the detectors
look for. The *problem* is confirmed.

**Does disprove:** that $80–125 is the going rate for the fix, and that the
scan-only niche merely being crowded is the main risk. The risk is that the tier
this lane targets no longer exists as a price point.

**Leaves open, and this is the live question:** whether the money is at the
€1,500 end. That end is a rights-and-trust business — a named firm a stranger
will hand their database to — which is the one thing an autonomous agent cannot
originate, and which `income/defaults.js` already records for the audit lane:
*"A person finds the first client. The machine cannot originate a trusted
relationship."*

## 5. Recommendation

1. **Correct the $80–125 figure** before any more work is priced against it. Done
   in CLAUDE.md, pointing here.
2. **Do not build another scanner tier.** Free exists; $5 exists; seven people
   will hand-fix for $10.
3. **The next real test is at the top, not the bottom** — whether anyone pays
   four figures for an audit with verified proof. That is one conversation with
   one named person, not a feature.
4. **If the GitHub lead engine matters, it needs a runtime that can reach GitHub**
   (see the parked task). It cannot be tested from a web session at all, which is
   worth knowing before more is built into it.

## Sources

- [Fiverr: rescue/fix lovable app, $30](https://www.fiverr.com/joshua_matth/rescue-fix-lovable-ai-website-lovable-dev-lovable-app-lovable-saas-mvp-vibe-code)
- [Fiverr: fix lovable deploy errors, supabase auth, $10](https://www.fiverr.com/forcybertech002/fix-lovable-dev-deployment-errors-supabase-auth-stripe-payment-integration-c3f7)
- [Fiverr: fix/deploy/migrate lovable + supabase, $20](https://www.fiverr.com/felicityquninn/fix-deploy-and-migrate-your-lovable-ai-app-supabase-expert)
- [Fiverr: nextjs/supabase, fix lovable, $25](https://www.fiverr.com/abrahamsamuel06/be-your-software-developer-nextjs-supabase-web-app-fix-lovable-base44-deployment)
- [Fiverr: fix/deploy lovable, replit, bolt, v0, $30](https://www.fiverr.com/vedrixappz/do-mobile-app-development-android-app-flutter-mobile-app-development-appsheet)
- [Fiverr: fix/deploy lovable, supabase, CI/CD, $40](https://www.fiverr.com/rahimahmad526/do-any-api-integration-in-wordpress-woocommerce)
- [theswarm.at — Supabase RLS audit, €1,500 credited toward fixes](https://theswarm.at/supabase-rls-audit/)
- [Vibe App Scanner — $5 / $14 / $29-mo tiers](https://vibeappscanner.com/best-ai-security-scanner)
- [SafeToShip — free 60-second URL scans, scanner comparison](https://safetoship.dev/blog/best-vibe-coding-security-scanners)
- [CheckVibe — from $0](https://checkvibe.dev/best)
- [Tested every vibe-coding security scanner, 2026](https://dev.to/solobillions/i-tested-every-vibe-coding-security-scanner-2026-heres-what-actually-works-p9k)
- [Lovable + Supabase: RLS gaps, service-role leaks, CVE-2025-48757](https://vibeappscanner.com/lovable-supabase-security)
- [Fortivibe — Lovable app security audit](https://fortivibe.com/audits/lovable-app-audit)
