---
name: send-and-log-outreach
description: Use whenever a message to a real person is being prepared, drafted, queued or discussed — a disclosure, a pitch, a reply, a follow-up — and whenever asking whether a lane is working, whether anyone has been contacted, or whether a lane should be retired.
---

# Send and log outreach

## Overview

Claude drafts. **The operator sends.** The attempt is then logged, or it did not
happen.

An unlogged send is worse than no send: it spends the prospect and leaves the
lane looking untried, so the next session builds more supply instead of
following up.

## The hard invariant

**Claude never contacts anyone.** Not email, not a GitHub issue, not a DM, not a
form, not a comment, not a PR.

**Violating the letter of this is violating the spirit of it.**

No exception for any of these, and they have all been argued:

- "The user clearly wants it sent" — then the user sends it.
- "It is only a draft in a public issue" — a public issue is contact.
- "It only asks for a security contact, it describes nothing" — still contact.
- "They explicitly authorised it earlier" — authorisation to draft is not
  authorisation to send, and it does not carry across messages.
- "It is time-critical, their key is live right now" — it has been live for
  months; ten minutes is not the constraint.

This is `CLAUDE.md` rule 2. It is also why the disclosure is believed: an
automated scanner that emails strangers unprompted is indistinguishable from the
thing the recipient is worried you are while reading paragraph one. **The
message is credible because a person sent it.**

## Red flags — stop

- About to use a tool that sends, posts, comments or opens an issue
- Thinking "I'll just open the issue, it's harmless"
- Logging an attempt before the operator confirms it went
- Drafting a second follow-up
- Putting a price or a link in the first message
- Quoting a sweep headline you have not re-derived

**All of these mean: hand it to the operator instead.**

## The loop

1. **Verify first.** REQUIRED: use `verify-lead-before-contact`. A draft built
   on the sweep's headline is a draft that gets disproved.
2. **Find a private channel.** `SECURITY.md`, private vulnerability reporting,
   a profile email, then commit metadata. If none exists, the fallback is a
   public issue that asks for a private channel and **describes nothing** — a
   public issue naming the flaw tells every reader where to look.
3. **Draft to `docs/outreach/YYYY-MM-DD-<target>.md`.** Include the verified
   numbers, the correction of our own headline if it differs, and the exact
   text to send.
4. **Hand it to the operator.** Say plainly: *Status: DRAFT. Not sent.*
5. **Log the attempt when they confirm they sent it:**
   ```bash
   npm run outreach -- log --lane <lane> --channel <email|issue|dm> --prospect <handle-or-url>
   ```
6. **Record the outcome** when it arrives: `PENDING → NO_RESPONSE | REPLIED |
   DECLINED | INTERESTED | PAID`.

## Why there is no price in message one — this is a conversion rule, not a scruple

Measured 2026-09-15: **"beg bounty"** is an established, widely-despised pattern
— report a minor issue, withhold the detail until payment is promised. It has
made small businesses skittish about answering *any* disclosure, which is the
market we are selling into.

The line between a welcome disclosure and a beg bounty is exactly two things:
**the finding is real**, and **the detail is given free with nothing asked**.
Our first message clears both. Putting a price in it does not make the sale
faster; it moves us into the category the recipient has been warned about, and
the reply rate goes to zero for every future message too.

The money is in the reply, and the reply is bought with the free finding.

## Match the tone to who is reading

The facts stay fixed; the register does not. A family-owned business, a solo
founder, a tradesperson — a warm peer-to-peer "heads up from someone who noticed"
outconverts a corporate security-firm pitch, because it reads as a real person
being straight rather than a vendor working an angle. A larger or more technical
outfit may expect the formal version. Pick the register for the reader.

Warm does not mean vague: the buddy tone must keep every credibility cue — how you
found it (public code), that you haven't touched their systems, and the specific
detail that proves you actually looked. A casual message about a security hole
with no proof of competence reads as sketchier than a formal one, not friendlier.

## What goes in the first message

| Include | Leave out |
|---|---|
| Rotate-first instruction, in order | The secret's value |
| One verified finding, named precisely | The sweep's headline count |
| That the key stays in git history | A price |
| Who you are, honestly ("automated scan, no track record") | A link to buy |
| That the advice stands whether or not they buy | An invoice |

A disclosure that reads as a sales hook with a vulnerability attached deserves
to be ignored.

## Why the log is not bookkeeping

`KILL_AFTER_ATTEMPTS = 50` and `breakEvenRateFor` both exist and **neither has
ever fired**, because nothing counted attempts. With no count, *"we tried and it
did not work"* and *"nobody tried"* are indistinguishable from inside this repo,
and the default is always to build — because building is the half that can be
observed. A week of 137 commits and zero settlements is what that looks like.

An empty lane reports **"not been tried, which is not the same as failed."**

## Real-world impact

First two attempts in this project's history were logged 2026-09-15. Before
that, `outreach_attempts` had **zero rows** while `KILL_AFTER_ATTEMPTS = 50` and
`breakEvenRateFor` had both existed for weeks, reading an empty table and
therefore unable to fire.

Logging those two also exposed that `--lane x` failed with "lane is required" —
a parse bug that surfaced at the exact moment an operator was trying to record a
message already sent. **An attempt harder to log than to make goes unlogged.**

## Rationalizations

| Excuse | Reality |
|---|---|
| "Sending it myself is faster" | Speed is not the constraint; credibility is |
| "I'll log it now, they'll send it in a minute" | The log counts sends. A row for an unsent message is a false record |
| "No reply after two days, I'll nudge" | Seven days. Six hours of silence is not data |
| "One more follow-up won't hurt" | Two is spam and costs more than the lead is worth |
| "I'll include the price so they don't have to ask" | A disclosure with a price attached is a sales hook |
| "The sweep said 71 critical, that's what I'll write" | It was one issue counted seventy times |

## Common mistakes

| Mistake | Reality |
|---|---|
| Sending anything yourself | Never. Draft and hand over. |
| Logging at draft time | The log counts sends, not intentions |
| Describing the vulnerability in a public issue | You just told everyone |
| Pitching in message one | Burns the lane's reputation on attempt one |
| Batch-drafting 19 disclosures | Verify each; unverified drafts are liabilities |

## The pipeline

This is one step of five. Each hands to the next; a step skipped is a step
somebody improvises later, under pressure, badly.

- **Before this:** `verify-lead-before-contact`
- **After this:** `handle-the-reply` — The moment somebody answers.

Choosing between them, or between this and anything else on the board, is
`deciding-the-next-step`.