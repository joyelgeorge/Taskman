# The AI-code debugging lane

_Opened 2026-09-07, on measured demand rather than on preference._

This supersedes `FIVERR_LANE.md` as the first gig to publish. The bookkeeping
lane is not wrong, it is just less evidenced — see "Why this and not
bookkeeping" below, which is the honest version of a decision that changed.

## What only you can do

1. **Create the Fiverr seller account.** Your identity, your KYC, your payout
   details. This system does not create accounts and never will, and Fiverr
   requires the account be operated by its owner.
2. **Publish the gig** below, edited so every line is true of you.
3. **Take the first order and do it by hand**, timing it honestly.

Nothing in this repository needs to run for any of that.

## Why this and not bookkeeping

The bookkeeping lane was chosen on 2026-09-03. Searching for evidence that
anyone pays for it turned up none: no forum requests, no job posts, no stated
budgets — and Stripe ships a Bank Reconciliation report free, with its NetSuite
connector auto-reconciling payouts to deposits. Competing with a free incumbent
feature, on a problem nobody is publicly asking to have solved, is a bad first
gig.

What the same search found instead, for AI-generated code:

- Fiverr has created a **category** for it:
  `programming-tech/vibe-coding/troubleshooting-improvements`. Marketplaces do
  not open categories without volume behind them.
- Live gigs, priced: **$30** "fix errors and bugs in your vibe coded website or
  app, replit, lovable", **$25** "fix or cleanup your vibe coding app", **$50**
  "fix your vibe code mess, working and improved".
- Upwork: a **$100** fixed-price posting, "Fix Vibe Coded App", contract to hire.
- One provider running this with **15-20 regular clients** — repeat work, not
  one-offs.
- The press has a name for the category: "slop fixer-uppers".

And the pain has numbers attached: one company lost **$47,000** to failed payment
processing after shipping AI-written code on a Friday; another found **47 subtle
bugs that only appeared under production load at 10,000 users**.

That second number is the whole reason to enter this market rather than the
first. Every competing gig sells *make it run*. Almost nobody sells *find what
your tests cannot catch* — and that is the thing this project spent weeks
demonstrating on its own codebase.

## The differentiator, stated precisely

Four production bugs were found in this repository, all of which passed a
595-test suite:

| Bug | Why the tests missed it | Commit |
|---|---|---|
| A query that could never execute against PostgreSQL | in-memory mode never ran the SQL | `6780227` |
| A table written to by code that no migration created | the write was caught and silently fell back to memory, returning `ok: true` | `3d0da3e` |
| A `CHECK` constraint the app violated on every call | memory mode enforces no constraints | `66a3773` |
| A date read back a day early | `node-postgres` returns DATE at local midnight; only wrong east of UTC | `22a1dc2` |

Each SHA is real and public. `git show <sha>` explains what the bug was and how
it hid — which is the evidence the gig rests on, so it must stay checkable.

The pattern behind all four: **the tests exercised a different storage backend
than production used.** That is endemic to AI-written applications, because the
model writes both an in-memory fallback and the real path, and the suite only
ever runs the easy one.

This is checkable by a buyer in about ten seconds, because the repository is
public and the commits describing each bug are in its history.

## The gig

### Title

> I will find the production bugs your AI-written app is hiding

Alternatives to test later, one at a time — never two changes at once:

- *I will debug your Lovable, Replit or Cursor app and fix what breaks in production*
- *I will audit your AI-generated codebase before it costs you real money*

### Category

Programming & Tech → Vibe Coding → Troubleshooting & Improvements.
That category exists; use it rather than a generic development one.

### Pricing

Deliberately above the $25-30 floor, because this is a different service from
"make it run" and pricing at the floor invites buyers who want that instead.

| Tier | Price | Scope | Delivery |
|---|---|---|---|
| Basic | $45 | One repo, up to ~5k lines. Written report naming each bug, where it is, and why the tests miss it. No fixes. | 2 days |
| Standard | $90 | The audit, plus fixes for everything found, plus the tests that would have caught them. | 3 days |
| Premium | $175 | Standard, plus a run against a real database rather than the app's in-memory mode, which is where most of these surface. | 4 days |

The first three orders are for the reviews, not the money. A five-star review at
$45 is worth more right now than one $175 order and no history.

### Description

> **What you get**
>
> I take your AI-written codebase and find the bugs that only appear in
> production — the ones your tests pass straight over.
>
> These are not style problems. They are the specific failures that happen when
> an AI writes both a simple in-memory version and the real database version,
> and the test suite only ever runs the simple one: queries that cannot execute
> against a real database, tables your code writes to that no migration ever
> created, constraints your app violates on every call, and dates that come back
> a day early outside UTC.
>
> You get a written report naming each one, where it is, and why your tests did
> not catch it. On Standard and above, you get the fixes and the tests that
> would have caught them.
>
> **Why me**
>
> I found exactly these four bugs in my own 595-test codebase. It is public, and
> the commit for each one explains what it was and how it hid. You can read them
> before you order.
>
> **What I need from you**
>
> - Repository access, or a zip
> - How you run it, and how you run the tests
> - Whether it uses a real database in production
>
> **What I will not do**
>
> I will not tell you the code is fine if it is not, and I will not pad a report
> to look thorough. If I find nothing, I will say so and refund the order.

### Requirements to set on the gig

- Repository URL or archive
- Which AI tool wrote it (Lovable, Replit, Cursor, Claude Code, Copilot)
- Production database, if any
- The command that runs the tests

## After the first order

Record it with the real minutes spent:

```bash
npm run fulfil -- --platform <n/a> --bank <n/a> --source paypal \
  --ref <fiverr-order-id> --gross <cents> --fee <cents> --minutes <actual>
```

The effective hourly rate that prints is the number that decides whether to raise
prices, change the tiers, or stop. A $90 order that took six hours is $15/hour
and is not a business; the same order in ninety minutes is $60/hour and is.

Fiverr takes 20%, and PayPal into India takes roughly 4.4% plus a 3-4%
conversion markup on what is left. A $90 order nets closer to **$66** than $90.
Price with that in mind rather than discovering it afterwards.
