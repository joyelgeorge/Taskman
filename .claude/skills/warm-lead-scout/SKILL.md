---
name: warm-lead-scout
description: Find people ALREADY asking for help securing their AI-built (vibe-coded) app, and draft a welcomed reply offering the free scan. The primary lead engine — warm inbound intent, not cold outreach.
---

# Warm Lead Scout

The cold drone (scanning strangers' repos) yields almost nothing sellable and is
ethically delicate. This is the opposite and the primary engine: find builders
who have already said, in public, that they need exactly what we do — then help
them. They have the problem, they want it fixed, and the outreach is welcome.

## Where to look (warm intent lives on platforms, not in generic web search)

Drive a browser or platform search over these, most-to-least warm:

- **Fiverr / Upwork buyer requests** — people literally paying: search "secure
  supabase", "fix lovable app", "RLS", "vibe coded security". Highest intent.
- **Reddit** — r/Supabase, r/vibecoding, r/nextjs, r/SaaS, r/webdev, r/Entrepreneur.
  Phrases: "is my app secure", "my supabase is exposed", "RLS help", "got hacked",
  "before I launch", "anon key safe?", "leaked my key".
- **IndieHackers** — launch and "roast my app" threads; founders worried pre-launch.
- **X/Twitter** — "vibe coded" + "hacked"/"exposed"/"security"; replies to Lovable/
  Bolt posts asking about safety.

## Qualify a warm lead (all three)

1. **Real builder with a real app** — not a student exercise, not a theory question.
   A named product, a live URL, or a described SaaS. (Reuse the lead-qualifier
   business gate in spirit.)
2. **Expressed need or worry** — they asked for help, said they're unsure, or got
   burned. Intent is the whole point.
3. **Reachable and welcome** — a thread or profile where a helpful reply fits the
   norms. Never DM cold where it breaks platform rules.

## The reply (draft only — the operator posts, never Claude)

Help first, sell second, never fear-monger:
- Lead with one genuinely useful, specific thing they can check right now (e.g.
  the `pg_tables … rowsecurity = false` query to list unprotected tables).
- Offer a **free scan** of their public repo and a plain report — no strings.
- Mention the paid fix only as the optional next step if they want it done for them.
- Keep it short, human, and specific to what they posted. No template smell.

## Output each run

A ranked list of warm leads: the link, a one-line quote of their pain, why they
qualify, and a ready-to-post draft reply. The operator reviews and posts. Nothing
is sent automatically, and no claim is made about their app that has not been
checked — the free scan is how the real finding gets confirmed.

## Rules

- Warm intent beats cold volume. Prefer one person who asked over a hundred who did not.
- Draft, never send. The human posts under their own identity.
- Free scan is public-source and read-only, same as the drone. Never probe a live
  system without the owner's explicit go-ahead in the thread.
