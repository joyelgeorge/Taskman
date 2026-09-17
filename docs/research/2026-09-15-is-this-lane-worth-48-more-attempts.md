# Is this lane worth the other 48 attempts?

Research, 2026-09-15. Two disclosures are sent; the kill criterion allows 48
more. This asks whether to spend them, and on what — **before** spending them.

Every claim below has a source. Where the answer is "nobody publishes this",
that is stated rather than filled in.

---

## 1. The two messages already sent are still valid

Supabase is a GitHub secret-scanning partner: keys found in public repos are
forwarded and **automatically revoked**. That would make a disclosure pointless.

It does not, here. The automatic revocation applies to the **new** key formats
(`sb_secret_…`, publishable/secret). **Legacy `service_role` JWTs — the
`eyJhbGci…` form — are explicitly described as harder to spot and are not
reliably revoked.**

Both flyrpro and Chalmers007 hold **legacy JWTs**. The findings stand.

## 2. But this surface is closing, and that is a timer on the lane

Supabase is retiring `anon`/`service_role` keys in favour of the fingerprintable
format. As projects migrate, a key committed to a public repo gets revoked
before we ever scan it.

**The public-GitHub lane's supply is a depleting stock, not a flow.** Any plan
that assumes it grows is wrong.

## 3. The surface we are scanning is the small one

| | Our lane | Deployed-bundle scanning |
|---|---|---|
| Targets found | 199 candidates | **20,052 URLs** |
| Scanned | 134 | 20,052 |
| Carrying an exposed secret | **4** | **2,217 domains (11.04%)** |
| Source of targets | GitHub code search | Five indie product directories |

A researcher scanned 20,052 deployed indie-launch URLs over one month and found
11.04% exposing Supabase credentials **in the client bundle**. That is a
different surface from ours: a key in a shipped JS file is not in a repo, so
GitHub's secret scanning never sees it and Supabase never auto-revokes it.

**It is roughly 50x the hit rate against ~100x the pool, and it is immune to the
mitigation that is closing our surface.**

It is also read-only in the same way ours is: fetching a public JS file a server
chose to serve. The same rules apply — never use a key, never touch the database.

## 4. Pricing spans 300x, and both ends are occupied

| Who | Price |
|---|---|
| The HN researcher (scan + fix report) | **$5** |
| `CLAUDE.md`'s recorded Fiverr range | $80–125 |
| Sherlock Forensics (vibe-coded app audit) | **from $1,500** |

The $5 end is a race we cannot win and should not enter. The $1,500 end exists
and is public. Our recorded $80–125 sits closer to the floor than the market
requires.

## 5. The niche is no longer uncontested

Named, live, selling into exactly this problem today: **vibeappscanner.com,
ship-safe.co, guardlayer.io, vibe-eval.com, ubserve.com, Sherlock Forensics**,
plus the HN researcher's free Chrome extension and audits.

`CLAUDE.md` calls scan-only "crowded" as of 2026-09-08. One week later it is
crowded with *named companies*. The wedge has to be fix-and-proof, not detection.

## 6. The reputational hazard has a name, and we are on the right side of it

**"Beg bounty"** is the established, widely-despised pattern: report a minor,
publicly-observable issue and **withhold detail until payment is promised**.
Security people treat it as extortion-adjacent, and it makes small businesses
skittish about answering *any* disclosure.

The distinguishing line, per Troy Hunt: legitimate disclosure is *"open, honest,
transparent, no ulterior motives"* — full detail given freely, no compensation
sought.

Our drafts: full location given, rotation instructions first, **no price, no
link, explicitly "nothing to buy"**, and the finding is a live credential rather
than a missing header. That is the right side of the line — but it is the right
side *because of those specific choices*, and adding a price to message one moves
us across it.

## 7. What nobody publishes

**There is no public conversion-rate data for cold disclosure → paid
remediation.** Not from HackerOne, not from Bugcrowd, not from practitioners.

That absence is itself information: this is not a trodden path with a known
yield. Our 50-attempt budget is not "testing a known channel", it is
**measuring one for the first time** — which is a reason to instrument it well,
and a reason not to assume a number.

---

## What follows

1. **Send the remaining verified leads.** The two sent are valid and the stock is
   depleting; nothing here argues for waiting beyond the 7-day reply window.
2. **Change the surface before spending the other 48 attempts.** Target deployed
   bundles from indie-launch directories, not GitHub code search. Same detector
   class, ~50x the hit rate, and immune to auto-revocation.
3. **Raise the price.** $80–125 was recorded from Fiverr. A published competitor
   charges from $1,500 for the same audit on the same apps.
4. **Never put a price in message one.** It is the single choice separating this
   lane from a pattern the industry despises.
5. **Do not build another scanner.** Six companies sell that. The differentiator
   is the verified fix and the before/after proof.

## Sources

- [Troy Hunt — Beg Bounties](https://www.troyhunt.com/beg-bounties/)
- [11% of vibe-coded apps are leaking Supabase keys — HN](https://news.ycombinator.com/item?id=46662304)
- [Supabase is now a GitHub secret scanning partner](https://github.blog/changelog/2022-03-28-supabase-is-now-a-github-secret-scanning-partner/)
- [Supabase Security Retro: 2025](https://supabase.com/blog/supabase-security-2025-retro)
- [Migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Sherlock Forensics — vibe coding security](https://www.sherlockforensics.com/pages/vibe-coding-security.html)
- [Lovable vulnerabilities — Superblocks](https://www.superblocks.com/blog/lovable-vulnerabilities)
