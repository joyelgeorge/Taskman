---
name: handle-the-reply
description: Use the moment a prospect responds to outreach — a thank-you, a question, a request for help, a push-back, or silence that has run long enough to answer — and whenever deciding what to offer, what to charge, or how much work to do before money.
---

# Handle the reply

## Overview

A reply is the first thing this project has ever been short of. Most replies are
lost in the next two messages, in one of two ways: **working for free forever**,
or **pitching before they asked**.

The reply is not the sale. The goal of this message is a *yes to the next small
step*.

## Read what kind of reply it is

| Reply | What it means | Next step |
|---|---|---|
| "Thanks, fixed it" | You gave value, they are done | Record `REPLIED`. Ask one question: would they want the rest checked? |
| "How did you find this?" | Testing whether you are a scraper | Answer honestly and specifically. This is the trust test. |
| "Can you fix it?" | **Buying signal** | Scope it. Use `price-and-deliver-the-fix`. |
| "Is there more?" | Buying signal, disguised | Offer the full audit, named price, fixed scope |
| "Who are you / is this a scam?" | Fair | No track record? Say so. Offer to do the first thing free and visible. |
| Silence past the follow-up window | Not a no, but not a lane | One follow-up, then `NO_RESPONSE` |

## Rules

- **Answer the "how did you find this" question straight.** You run automated
  scans of public repositories, this one matched, you have no track record yet.
  Every evasion here reads as a scam, and it is the most common first question.
- **One follow-up, ever.** Then mark `NO_RESPONSE` and move on. Two is spam and
  it costs the lane more than the lead is worth.
- **Do not do the work before the yes.** Finding and reporting is free. A fix is
  not. The free scan is the marketing; the fix is the product.
- **Do not negotiate against yourself.** If they say a price is high, ask what
  scope would work, do not drop the number unasked.
- **Never take credentials.** If they offer a key, a login, or database access
  to "have a look", decline and tell them to rotate anything already shared.
- Update the outcome the same day: `npm run outreach -- outcome <id> <OUTCOME>`.

## What a good next message looks like

Short. One offer. One price. One thing for them to say yes or no to. No
attachments, no deck, no list of everything you could do.

## Common mistakes

| Mistake | Cost |
|---|---|
| Free-scoping a whole audit to prove value | The value was the disclosure; now the work is free |
| Waiting for a "better" moment to mention price | The moment was when they asked "can you fix it" |
| Three follow-ups | The lane gets a reputation before it gets a customer |
| Accepting access to their production system | Liability you cannot carry, and you did not need it |
