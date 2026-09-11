# Audit lane — getting the first client

**Status:** the only CRITICAL item in this repository. `payout-audit-direct` is
`state: TESTING`, `unblockedBy: 'human'`, and its own recorded next action is
*"Market the live audit tool to potential audit clients to drive first paid
settlement."* Everything needed exists. Nobody has been shown it.

**The operator sends these. Claude drafts, never posts, never messages.**

---

## What is actually true

Every claim below was checked against the source, because outreach built on an
unverified claim is how this lane dies a second time.

| Claim | Verified |
|---|---|
| The tool is live | https://taskman-operator.web.app |
| It runs entirely in the browser | `packages/web/public/audit/` is three static files — `index.html`, `instant-audit.js`, `payout-csv.js`. **Zero `fetch` calls, no form action, no POST.** Nothing is uploaded. |
| No signup, no account, no storage | `instant-audit.js` is the stateless path, built specifically to remove the three signup gates that meant *"the only people who could ever see a finding were people who had already signed up."* |
| It names specific orders | Not "a variance of $200" but "order FO124, $200.00, earned 5 Aug, never deposited" — checkable against their own bank in a minute. |
| Price | **20% of what they confirm they recovered. Nothing if nothing comes back.** Via https://paypal.me/joyelgt — **not** the `/20USD` link, which is a leftover from the withdrawn flat-fee model. |
| It will not accuse anyone | `matchPayouts` reports unmatched earnings as *"no deposit found in these files"*, never as theft. A false accusation ends the relationship. |

### What must never be claimed

**There are zero settlements. No client has ever paid.** So: no testimonials, no
"we've helped N agencies", no case studies, no invented recovery figures. The
$2,862 figure in `pricing.js` is from a **demo**, and may only be described as
what the tool found in a demo.

This is not a handicap to work around. It is why the pricing is contingency:

> *A stranger is being asked to open their bank export for someone with no track
> record. At $20 up front the question is "why would I trust you"; on
> contingency there is nothing to trust — if nothing is found, nothing is owed.*

Lead with that. It is the honest version and the strongest version.

## Who

Verified from `src/customer-profile.js`:

- Boutique digital agency owners, Top-Rated / Fiverr Pro freelance studios
- Doing **more than $3,000/month** in platform volume
- Currently reconciling by **manual CSV export into Excel, 4–8 hours a month**
  (~$250/month of founder time)

## When — the three buying triggers

Do not broadcast at random. These are the moments the problem is already on
someone's mind, recorded in the profile:

1. A **month-end bank deposit discrepancy** — "my payout doesn't match my orders"
2. **Tax prep** — an accountant asking for a platform-fee breakdown
3. An **unexplained deduction or chargeback alert**

Someone posting any of these has the problem *today*. That is the moment.

## Where

Fiverr Community Forum · r/Fiverr · r/freelance · Fiverr Top Rated Sellers
Facebook group · Digital Freelancer Discord · Upwork & Fiverr Agency Hub
(LinkedIn) · QuickBooks Community Forums · Indie Hackers freelancing group

**Reply in public threads where it fits. Do not cold-DM.** A helpful reply to a
stated problem is welcome; an unsolicited message about money is not.

---

## Draft A — replying to someone reporting a discrepancy

> Had the same thing and ended up building a small tool for it, so this might
> save you the spreadsheet evening.
>
> Export your platform earnings CSV and your bank statement CSV, drop both into
> https://taskman-operator.web.app — it matches each order against a deposit and
> lists the ones with no deposit against them, by order ID and date, so you can
> check them against your own bank.
>
> It runs entirely in your browser. No signup, nothing uploaded, nothing stored —
> it's three static files, you can close the tab and it's gone.
>
> It won't tell you anyone stole anything. Sometimes a payout is just batched or
> delayed. It tells you which specific orders to go ask about.
>
> Free. If it turns up something real and you actually get the money back, I take
> 20% of what you recover — and nothing at all if you recover nothing.

## Draft B — a standalone post, where self-promotion is allowed

> **If you reconcile Fiverr/Upwork payouts by hand, this might be an hour back**
>
> I kept losing an evening a month matching platform earnings against bank
> deposits in a spreadsheet, so I built the matcher.
>
> Two CSVs in — earnings and bank — and it names the orders that were earned but
> never landed, plus any fees that sit outside your own normal range. Specific
> order IDs and dates, not a summary number, so every line is checkable against
> your bank in a minute.
>
> Runs in your browser. No account, no upload, no storage.
>
> **Being straight about two things:** it's new and nobody has paid me for it
> yet, and it can only see what's in the two files you give it. If it finds
> something and you actually recover it, I take 20% of that recovery. If it finds
> nothing, you owe nothing and I'd rather you told me it was useless.
>
> https://taskman-operator.web.app

## Draft C — the follow-up, only after they say it found something

> Glad it caught something. Two things worth knowing before you chase it:
>
> A gap in those files isn't proof of anything — it's usually a batched or
> delayed payout. The useful move is quoting the specific order IDs and dates to
> platform support and asking them to trace those payouts.
>
> If the money does come back, the fee is 20% of what you actually recovered —
> https://paypal.me/joyelgt — and if it doesn't, we're square either way. Tell me
> what they come back with; it's the only way this gets better at knowing what's
> real.

---

## When someone pays

**Do not hand-write a settlement record.** `money-ledger.js` refuses
self-reported revenue by construction: `source` must be one of `stripe`,
`paypal`, `bank`, `manual_receipt`, and `externalRef` must be non-empty.

Record it through `recordSettlement` with the PayPal transaction ID as
`externalRef`. That row is the goal of this entire repository. When it exists:

1. Update `payout-audit-direct` in `packages/core/income/defaults.js` from
   `TESTING` to whatever the evidence then supports.
2. Update `docs/READ-FIRST.md` — its closing line, *"`settlements` is empty,
   everything else is commentary"*, will no longer be true, and a read-first
   document that has drifted is worse than none.
3. Note in `docs/BRAIN-TRANSFER.md` §14 what actually worked, in the same commit.

## If it does not work

Record that too, in the disproof registry, with the number of approaches made
and the responses. A lane that was tried and failed is worth more written down
than a lane nobody tried — and `killCriteria` for the wedge already exists in
`commercial-wedge.js`: trailing-30-day ROI below 1.5x after 50 attempts with
zero conversions.
