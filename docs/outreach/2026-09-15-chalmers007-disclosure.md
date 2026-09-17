# Disclosure draft — Chalmers007/ordering-platform

**Status: DRAFT. Not sent. The operator sends this; Claude does not contact anyone.**

Verified 2026-09-15 by cloning the **public** repository and reading it. No
system was accessed, no credential was used, nothing was tested against their
live service, and the clone was deleted. **The key value is not recorded here or
anywhere in this repository.**

| | |
|---|---|
| Repo | `Chalmers007/ordering-platform` (public, 0 stars) |
| Product | "Multi-tenant white-label restaurant ordering and delivery platform. Next.js, Supabase, **Stripe Connect**" |
| Deployed | `ordering-platform-sigma.vercel.app` |
| Activity | Pushed 2026-09-13 — actively developed |
| Contact | No SECURITY.md, no private reporting, no profile email. Commit metadata: **Scott Chalmers <connectentinc@gmail.com>** |

This is a real commercial product: multi-tenant, SaaS billing, Stripe Connect,
live tenants. It is the strongest lead in the queue.

---

## What the sweep said, and what is actually true

The sweep reported **14 issues, 14 crit**. Two of its three classes do not
survive inspection. **Send only the first row.**

| Class | Sweep | Verified | Verdict |
|---|---|---|---|
| `exposed-secret` | 9 | **1 key, in 9 files** | **Real — this is the disclosure** |
| `unauthenticated-admin-route` | 6 | **0** | **False positive. Do not mention.** |
| `missing-rls` | 5 | **4 tables** (+1 subtle) | Real, secondary |

### The finding — one key, nine files

A Supabase `service_role` key is hardcoded in nine scripts:

```
scripts/apply-full-migration.mjs:5      scripts/promote-admin.mjs:4
scripts/apply-preview-migration.mjs:5   scripts/setup-preview-bucket.mjs:5
scripts/check-admin.mjs:5               scripts/verify-preview-tables.mjs:5
scripts/create-preview-tables.mjs:5     scripts/verify-tables.mjs:5
scripts/do-promote.mjs:5
```

**All nine hold the same key** — confirmed by hashing each occurrence, without
recording the value. So the honest description is *one key exposed in nine
places*, not nine leaked keys. Say it that way; it is both true and worse,
because removing it from one file fixes nothing.

A `service_role` key bypasses Row-Level Security entirely: full read/write on
every table, including the 30 that are correctly protected.

### The admin routes are guarded — our scanner was wrong

The sweep flagged six unauthenticated admin routes. **All six call
`requireSuperAdmin()`** and return 401/403:

```
check-uber-customer-id  dispatch-health  set-demo-uber-id
test-preview            webhooks/drain   tenants/[id]
```

Telling a developer their admin routes are unauthenticated when they are plainly
guarded is how you lose the conversation in one reply — they will open the file
and see the guard. **This is a detector bug on our side**, filed as a task.

### RLS — real, and they already know how

30 `enable row level security` statements exist in the migrations, so this team
uses RLS deliberately. Four tables were created without it:

- `package_purchases` — **purchase records**, the one that matters commercially
- `raven_provisioning_requests`, `raven_provision_nonces`, `demo_fallback_state`

One subtler thing worth raising carefully: `tenant_activation_requirements` has
a `create policy` but no `enable row level security` that I could find. **A
policy on a table without RLS enabled does nothing** — it reads as protected and
is not. Phrase it as "I could not find an ENABLE for this one, worth checking",
not as an assertion.

---

## Draft 1 — the email (send this)

> **Subject: service_role key committed in ordering-platform (9 files)**
>
> Hi Scott,
>
> I run automated security scans over public Supabase repos and
> ordering-platform came up. One thing is worth doing today.
>
> Your Supabase `service_role` key is hardcoded in nine scripts under
> `scripts/` — `apply-full-migration.mjs`, `check-admin.mjs`, `promote-admin.mjs`
> and six others, all around line 5. It is the same key in all nine, so removing
> it from one file does not help.
>
> That key bypasses RLS completely, so it is full read/write on every table —
> including the thirty you have correctly protected.
>
> I only read the public source. I have not used the key, I have not touched
> anything of yours, and I am not including it in this email.
>
> In order:
>
> 1. Rotate the service_role key in the Supabase dashboard. That invalidates the
>    exposed one immediately.
> 2. Replace the nine hardcoded fallbacks with an env var read that fails loudly
>    when it is missing.
> 3. The old key stays in git history after you edit the files — rotating is what
>    actually fixes this, not the commit.
>
> Two smaller things while I was in there. `package_purchases`,
> `raven_provisioning_requests`, `raven_provision_nonces` and
> `demo_fallback_state` look like they were created without RLS enabled — you
> clearly use RLS everywhere else, so these read like ones that slipped through.
> And `tenant_activation_requirements` has a policy but I could not find an
> `enable row level security` for it; a policy without RLS on does nothing, so
> that one is worth a look even though it appears protected.
>
> Nothing attached and nothing to buy — rotate the key whether or not you reply.
>
> Joyel

## Draft 2 — public GitHub issue, only if the email bounces

> **Title: Security contact?**
>
> Hi — I found something in this repository that should be handled privately and
> there is no SECURITY.md or private reporting enabled. Could you turn on private
> vulnerability reporting, or point me at an email? Happy to send details there.

**The issue must describe nothing.** Naming the file or the key class in a public
issue tells every reader exactly where to look, on a repo with a live product.

---

## Rules for this contact

- The operator sends. Claude does not email, comment, or open issues.
- No price, no link, no invoice in the first message.
- If asked how it was found: automated scans of public repositories, this one
  matched, no track record yet. Answer straight — evasion reads as a scam.
- Do **not** mention the admin routes.
- Log it after sending:

```bash
npm run outreach -- log --lane vibe-app-security --channel email --prospect Chalmers007/ordering-platform
```
