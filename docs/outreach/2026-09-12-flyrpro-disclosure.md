# Disclosure draft — danielphillippe27-netizen/flyrpro

**Status: DRAFT. Not sent. The operator sends this; Claude does not contact anyone.**

Prepared 2026-09-12 from sweep run
[34688151638](https://github.com/joyelgeorge/Taskman/actions/runs/34688151638).

---

## What was verified, and how

Everything below was checked by cloning the **public** repository and running
`src/codebase-audit.js` over it. **No system was accessed, no credential was
used, nothing was tested against their live service.** The clone was deleted
afterwards. The key value is not recorded here or anywhere in this repo.

| | |
|---|---|
| Repo | `danielphillippe27-netizen/flyrpro` (public) |
| Product | Deployed at flyrpro.vercel.app as **WolfGrid** — field prospecting / territory management. **Has a pricing page** (`/plans`), so it is commercial |
| Stack | Next.js 15, Supabase, Stripe |
| Activity | Created 2025-10-12, pushed 2026-09-09 — actively developed |
| Contact | No SECURITY.md, no private vulnerability reporting, no profile email. Commit metadata: **Daniel Phillippe <daniel.phillippe27@gmail.com>** |

### The finding that matters

`scripts/stamp-addresses-with-gers.ts:70`

```js
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '<a real JWT literal>';
// their comment: "fallback to hardcoded key (same as lib/supabase/server.ts)"
```

A Supabase `service_role` key **bypasses Row-Level Security entirely** — it is a
full read/write master key for the database. It is committed in a public
repository, and their own comment says the same pattern exists in a second file.
The Supabase project URL is hardcoded beside it, so no guessing is required.

### Correcting the headline number

The sweep reported "73 issues, 71 crit". **Do not say that to them.** Verified
breakdown:

- `exposed-secret` — **1** (the one above)
- `missing-rls` — **70**, but across 12 files: 14 in `supabase/migrations/`,
  56 in `supabase/schema.current.sql`. That is one systemic issue — RLS not
  enabled on many tables — not seventy separate holes.
- `ssrf` — 2. Plus non-security classes the scan also reports.

Saying "71 critical vulnerabilities" would be technically defensible and
practically dishonest, and would be the first thing a competent developer
disproves.

---

## Draft 1 — the email (send this)

> **Subject: Security issue in the public flyrpro repo — service_role key**
>
> Hi Daniel,
>
> I run automated security scans of public repos built on Supabase, and flyrpro
> came up with something I think you'll want to fix today.
>
> `scripts/stamp-addresses-with-gers.ts` line 70 has your Supabase
> `service_role` key as a hardcoded fallback, and the comment there says the
> same fallback exists in `lib/supabase/server.ts`. The project URL is
> hardcoded next to it. A service_role key bypasses RLS completely, so anyone
> who reads that file has full read/write on your database.
>
> I only read the public source — I haven't used the key or touched anything of
> yours, and I'm not including it in this email.
>
> What I'd do, in this order:
>
> 1. Rotate the service_role key in the Supabase dashboard now. That invalidates
>    the exposed one immediately.
> 2. Remove the hardcoded fallbacks so the code fails loudly without the env var
>    instead of quietly using a committed key.
> 3. Note that the old key stays in your git history after you change the file —
>    rotating is what actually fixes it, not the commit.
>
> Separately, the scan also flagged that Row-Level Security doesn't look enabled
> on a lot of tables in `supabase/migrations/` and `schema.current.sql`. That's
> the usual second half of this problem: once the key is rotated, RLS is what
> stands between an anon key and your data. Happy to send the specific tables if
> useful.
>
> No pitch attached — rotate the key whether or not you ever reply. If you do
> want help closing the RLS side properly I do that kind of work, but that's
> entirely separate and I'd rather you were safe either way.
>
> Joyel

## Draft 2 — public GitHub issue, only if the email bounces

**Do not describe the vulnerability in a public issue.** Anyone reading it knows
where to look.

> **Title: Security — private contact?**
>
> Hi — I found a security issue in this repo and I don't want to describe it in
> a public issue. Is there an email or another private channel I can use?
> Alternatively, enabling GitHub's private vulnerability reporting on this repo
> (Settings → Security) gives me a way to send it properly.

---

## Rules for this contact

- **Rotate-first, help-first.** The advice stands whether or not they buy
  anything. If the message reads as a sales hook with a vulnerability attached,
  it deserves to be ignored.
- **Never include the key**, not even truncated, in any channel.
- **No invoice, no price, no link** in the first message. `CLAUDE.md` requires a
  human decision before any submission or outreach; this is that decision.
- **Do not publish the finding** anywhere — not a blog post, not a thread, not
  as a case study — without their explicit permission.
- If they ask who you are: you run security scans of public Supabase repos, you
  found this one automatically, and you have no track record yet. That is true,
  and it is a better answer than implying otherwise.

## Log it

```bash
npm run outreach -- log --lane=vibe-security --channel=email \
  --prospect=danielphillippe27-netizen/flyrpro \
  --note="service_role key hardcoded fallback; disclosure sent, rotate-first"
```

Then record what comes back:

```bash
npm run outreach -- outcome <id> REPLIED    # or NO_RESPONSE / DECLINED / INTERESTED / PAID
```

This is attempt 1 of the 20 that decide whether the lane converts.

## If they reply

The paid work, if any, is the RLS remediation — enabling row-level security
across the tables and verifying it holds. That is a fixed-fee, short-loop
deliverable of exactly the kind `docs/TARGETING-PLAN.md` argues for, and the
market rate named in `CLAUDE.md` is $80–125.

Quote a number only after they ask.
