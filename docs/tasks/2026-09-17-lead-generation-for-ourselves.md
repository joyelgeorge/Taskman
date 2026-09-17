---
status: open
priority: P1
level: 2
opened: 2026-09-17
---

# Lead generation for ourselves: the options that are not email, buying, or scraping

Raised by the operator 2026-09-17: lead generation inside Taskman, for Taskman's
own use rather than as a product. Stated constraints — **personal email sending
is slow, buying leads is expensive, scraping is not working.**

All three are true. They also share one shape: **you go find the person.** Every
one is push, every one requires originating contact with a stranger, and that is
the exact thing `READ-FIRST.md` names as the constraint no lane here has ever
cleared.

So the useful question is not "a better way to find people" but **"what produces
a conversation without originating one."** Four answers, ranked by leverage per
unit of human interaction.

## First, a correction to the premise

**"Email is slow" is a prediction, not a measurement.** Zero outreach attempts
have ever been recorded in this repository — `scripts/outreach.mjs` exists and
logs, and nothing has run it. The kill criterion is 50 attempts with zero paid,
and it has never been able to fire.

Email may well be too slow. But the first send is also the cheapest experiment
on the board, and "too slow" cannot be the reason to skip it before one exists.
Note the distinction honestly: slow at *scale* is a real objection; slow at *n=1*
is untested.

## Why scraping is not working — measured, and narrower than it looks

Verified 2026-09-17 from this session:

- `git clone` of a third-party repo: refused (repo scoping).
- `curl` to `vercel.com`, `lovable.dev`: **403 CONNECT, proxy policy denial.**
- Reddit, Stack Overflow: refuse the crawler outright.

So a Claude Code web session cannot acquire a target by clone, fetch **or**
crawl. That reads as "scraping is dead" and it is not — it is **"this runtime
has no egress."** GitHub Actions has `gh`, a token and open network; a Managed
Agents per-session container has bash and its own network. The drone's home was
never a web session.

**Do not conclude scraping fails until it has been tried from a runtime that can
reach the internet.** That is a one-workflow test, not a rebuild.

## Option 1 — Borrow someone else's distribution (highest leverage)

**One conversation buys many leads.** This is the same insight that just replaced
the Tally P0: a chartered accountant already holds the client trust and the data
access we cannot originate, and serves many retailers.

The vibe-security equivalents, in order of how assembled the audience already is:

- **Agencies that build on Lovable / Bolt / v0** — they ship many client apps on
  the same stack, carry the liability, and have the relationship we cannot make.
  One agency is a book of accounts.
- **The platforms themselves** — a tool whose generated apps keep leaking has a
  reputational problem it is already aware of (CVE-2025-48757 hit 170+ Lovable
  apps).
- **Communities and newsletters in that stack** — borrowed attention rather than
  borrowed trust, so weaker, but cheaper to approach.

Why this beats the other three: it does not solve acquisition, it **removes**
it. And it converts the operator's scarcest resource — willingness to talk to
strangers — into the highest possible yield per conversation.

## Option 2 — Make the finding the introduction

A free, unconditional disclosure of a real bug is **not cold outreach.** It is
welcome contact, it arrives with proof instead of a pitch, and `CLAUDE.md`
already frames the entire lane this way.

This dissolves part of "email is slow": the bottleneck was never the sending, it
is having something worth sending. A message that opens *"your `service_role` key
is in your client bundle at this line"* is a different object from a cold pitch,
and converts like one.

Requires targets, so it depends on Option 3 or on a runtime with egress.

## Option 3 — Change the surface, not the channel

If the cold funnel survives at all, **deployed bundles beat repositories** on
three axes at once, per `expanding-the-search`:

- Claimed ~50x hit rate.
- Immune to GitHub auto-revocation, so findings decay slower (R6).
- **A deployed site with a working storefront is itself the business
  qualification** — it answers R1 for free, and R1 is what `thread-and-form-store`
  failed when a perfect finding landed in a template.

The `scan-bundles` skill that `expanding-the-search` points at **does not
exist.** The highest-value axis in the repo's own expansion list is a dangling
reference. Writing it is cheap; testing it requires egress.

## Option 4 — Be found (the only one that fits "no human interaction")

Free-scan-as-marketing is crowded — SafeToShip is free, CheckVibe starts at $0.
Competing there is competing on the commoditised axis.

The **uncrowded** pull asset is the one thing here no competitor can copy,
because it is measured rather than claimed:

> 19 CRITICAL leads re-audited to **4** real exposed secrets. One schema dump
> counted as **70** criticals. **6 of 6** admin routes falsely flagged by a
> helper the check never looked for.

Nobody has published evidence that these scanners lie, with numbers. That
artifact self-selects its audience perfectly: whoever reads *"your scanner is
lying to you"* ran a scanner and got a frightening number — a pre-qualified
inbound lead who arrives already holding the problem.

It also feeds the channel that did not exist a year ago: people now ask a model
"is my Supabase app secure", and being the source it cites is a real 2026
distribution channel — CheckVibe sells AEO checks as a product line, which is
evidence the channel is worth money to someone.

## Recommendation

1. **Option 1 is the answer to the question as asked.** It is the only one that
   makes the operator's limited appetite for human contact buy more than one
   lead at a time, and it is the same shape as the insight that just reordered
   the board.
2. **Option 4 is the best thing to build**, and the asset already exists in
   `docs/research/` — it needs writing up for an outside reader, not new work.
3. **Do not conclude scraping failed** until it runs from a runtime with egress.
   That is a GitHub Actions workflow, and it is small.
4. **Send one email before deciding email is slow.**

## Done looks like

One named agency, platform or accountant has been approached — logged through
`scripts/outreach.mjs`, so that for the first time in this repository's history
the attempt count is not zero.
