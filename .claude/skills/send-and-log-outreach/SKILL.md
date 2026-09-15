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
form. No exception for "the user clearly wants it", "it is only a draft", or "it
is just a comment asking for a security contact."

This is `CLAUDE.md` rule 2 and it is the reason the lane still has a reputation.

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

## Common mistakes

| Mistake | Reality |
|---|---|
| Sending anything yourself | Never. Draft and hand over. |
| Logging at draft time | The log counts sends, not intentions |
| Describing the vulnerability in a public issue | You just told everyone |
| Pitching in message one | Burns the lane's reputation on attempt one |
| Batch-drafting 19 disclosures | Verify each; unverified drafts are liabilities |
