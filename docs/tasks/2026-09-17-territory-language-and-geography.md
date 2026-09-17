---
status: open
priority: P2
level: 3
opened: 2026-09-17
---

# Territory: the markets our research has never looked at

Researched 2026-09-17. Every demand pass this project has run has been in
English, against English-speaking markets, where **thirteen named competitors
already sit.** This checks the axis nobody here has changed: language and
country.

Gate order is `taskman-verify`'s, and the first gate kills most of it:
**can the money reach this person, in this country, as an individual?**

## Russia / Belarus / CIS — KILLED on the payment rail

Not a judgement about the market. The rail does not exist for us.

As of Q1 2026 there is a **"granular infrastructure blockade"** — bank-specific
SWIFT cutoffs, correspondent-account bans, card-network exits — that breaks
payment mechanically whether or not any party is personally sanctioned. PayPal
is effectively unavailable. Anyone routing a real payment must first confirm the
client *can lawfully pay*, the bank *can receive*, and the rail *supports
Russia-based users*.

This is the Algora failure exactly: volume is irrelevant when the money cannot
arrive. **Do not spend time here.** Record in the registry as
`russia-cis-freelance` so a future discovery run meets the kill rather than
rediscovering the market.

Stablecoins are the documented workaround for blocked corridors. That is a
different business with its own compliance burden, and it is not this one.

## China — UNPROVEN, and expensive to prove

No usable data found on India→China individual payment rails. The known shape —
local entity requirements, Alipay/WeChat rails, platform access — means the
research cost to answer gate 1 is itself high. Left unproven rather than
guessed. **Do not build toward it without answering gate 1 first.**

## Latin America — the one that survives all five gates

**Workana**: largest LATAM freelance marketplace, 2M+ registered freelancers,
600k+ companies, 20k+ projects a month, operating in **Spanish and Portuguese**
across Mexico, Brazil, Colombia, Argentina, Chile. Commission is tiered and
falls with relationship depth: **20% on a first contract, 10% past $300
cumulative with that client, 5% past $3,000.**

That tiering matters more than the headline rate — it prices *exactly* the
repeat-client relationship the agency wedge is built on.

### The actual insight, which is not "go on Workana"

Competing as another freelancer against local Spanish speakers on price is the
$10–40 race we already measured and lost.

**The uncontested thing is the content.** All thirteen competitors counted on
2026-09-17 publish in English. The teardown — measured, self-critical, the one
asset nobody can copy — **has no Spanish or Portuguese equivalent in this
niche.** A translated teardown competes against nothing, in a market with 2M
freelancers and 600k companies building on the same Supabase stack and making
the same RLS mistakes.

Translation is near-zero cost here and the artifact already exists.

## Done looks like

Either: the teardown published in Spanish or Portuguese with its own link, and a
measurement of whether it drew anything the English one did not.

Or: a recorded kill — that non-English distribution reaches nobody we can serve
or bill — written into the registry so it is not rediscovered.

**Not:** a Workana seller account competing on price.
