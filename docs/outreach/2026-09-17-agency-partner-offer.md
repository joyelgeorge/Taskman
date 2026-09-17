# The agency wedge: pre-handover security certification

Drafted 2026-09-17. **The operator sends this. Nothing here goes out
automatically, and no message is sent to anyone this file names.**

## Why an agency rather than a founder

Cold-contacting solo builders on GitHub sells to people who often have no budget
and no legal accountability. An agency shipping client apps on Lovable / Bolt /
Cursor / Supabase inverts all three variables:

| | Solo builder | Agency |
|---|---|---|
| Apps per conversation | 1 | **10–30** |
| Who is liable when client data leaks | nobody, really | **the agency** — the client fires or sues them, not Lovable |
| In-house AppSec | no | **also no** — they hire for UI, product and prompt-craft |
| Budget | often zero | a cost of delivery, already priced into projects |

The liability row is the one that makes this work. An agency is not buying a
scanner; it is buying **not inheriting production liability at handover.**

## The offer

> You build in 48 hours. We certify the database before client handover, so you
> don't inherit production liability.

**Delivered per app:** an RLS audit against the live schema, a client-bundle
secret sweep, auth-guard verification on privileged routes, and CORS review —
then a **re-run after the fixes, showing the findings gone.** The proof of the
fix is the deliverable, not the list of problems.

> **Fulfilment status, 2026-09-17.** This offer made three technical promises
> and two were unbuilt when it was written — a live case of selling ahead of the
> product, which is the usual failure here running backwards.
> **All three are now built.** `packages/core/findings/report.js` gives
> distinct-problem counting, so no count leaves without a unit, and
> `proveFixed()`, the re-run diff that is the deliverable above.
> `packages/core/findings/reachability.js` gives the refuter: two independent
> signals — is this on a request path, and is the value attacker-settable —
> kept separate rather than averaged, so a shell call in `scripts/` that
> interpolates `req.body` comes back **contested** instead of dismissed.
> Every promise in this document is code, and each was verified by breaking it
> and watching a test go red.

**What makes it different from the free scanners:** every finding has survived a
refutation pass. No count without a unit, no route called naked when a helper
guards it, no injection flagged in code no request reaches. The published teardown
is the evidence, and it is our own miss rate, which is why it is credible:
https://gist.github.com/joyelgeorge/657593108ec060655ec7dcee2b2b426e

> **One open item before anyone leans harder on "seven".** The lead queue counts
> `fortixx-saas` among the seven, while an earlier row in the same file marks its
> 5 command-injection findings **"Unverified. Check before believing."** The
> closing line says all 22 are verified, which supersedes it — but nobody has
> recorded the check. If it did not clear, the number is six. The published piece
> says seven on the summary's authority; resolve this before it is quoted again.

## Pricing — proposed, and explicitly unvalidated

- **$150–300** per app at handover, or
- **$500/month** retainer covering up to 5 app audits.

> **Do not treat these as researched.** `CLAUDE.md` carries a standing rule after
> the 2026-09-17 price correction: do not price new work without re-measuring.
> The only adjacent measurement we hold is **theswarm.at at €1,500** for a
> Supabase RLS audit credited toward fix work — a different buyer (direct, not
> agency) at roughly 5–10x this. The B2B-liability framing may support more than
> $300; the $10–40 Fiverr floor is a different buyer entirely and is not the
> comparable.
>
> **The first conversation is the price measurement.** Ask what they pay now for
> pre-launch checks, before quoting.

## Finding the first one

Warmest first. Do not start with a stranger:

1. **Agencies already in the repo's own lead data.** `npm run warm-scout`
   surfaces GitHub threads from people asking for help on this stack; some are
   agency accounts rather than individuals. Check before going outside.
2. **Agencies with a public client list on the Lovable / Bolt showcase pages** —
   they have advertised that they ship on this stack, which is the qualification.
3. **Anyone the operator already knows** who runs a dev shop. One warm
   introduction outranks fifty cold ones, and this project has never once tested
   a warm one.

## The message

Short, specific, no fear-selling. The teardown does the credibility work, so the
message does not have to.

---

**Subject:** Pre-handover security check for your Supabase builds?

Hi [name],

I saw [specific thing — a client app, a showcase entry, a post]. You're shipping
on Supabase fast, which is the part I'm interested in.

I do one narrow thing: a pre-handover security pass on vibe-coded apps — RLS
actually enabled, no `service_role` key in the client bundle, admin routes
genuinely guarded — and a re-run afterwards that shows the fixes landed.

The reason I'm writing to agencies rather than founders: when a client's data
leaks because RLS was never switched on, it's the agency that hears about it,
not the platform.

I re-audited a batch of apps our own scanner flagged as critical and wrote up
how often it was wrong: it called 19 critical, and after checking all 22 by hand,
seven had something worth sending. It's here if useful:
https://gist.github.com/joyelgeorge/657593108ec060655ec7dcee2b2b426e. It's our own miss rate, not a competitor's.

Happy to do the first one free on an app you've already shipped, so you can see
the report before deciding anything. No obligation, and I won't touch anything
live.

[name]

---

## Rules that bind this offer

- **Free first pass, unconditional.** The scan is how they see the work; the fix
  is the product. Never condition a finding on payment.
- **Read-only, public artifacts only.** No live system touched, no credential
  used, no data pulled through a hole we report. Their explicit go-ahead in
  writing before anything beyond static analysis.
- **Never quote a number that has not been re-derived** from a fresh clone. The
  whole pitch is accuracy; arriving with an inflated count destroys it in one
  move.
- **At most one follow-up.** Two is spam and costs more than the lead.
- **Log every send** through `scripts/outreach.mjs`, or the lane stays
  indistinguishable from untried — which it has been for this project's entire
  history.

## Done looks like

One agency contacted and logged. Not a template refined, not a second channel
opened. The attempt count moving from **0 to 1** is the whole goal of this
document.
