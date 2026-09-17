# We re-audited every app our own scanner called critical. It was wrong about 15 of 19.

**Status: draft, cleared for publication.** Written 2026-09-17 for an outside
reader — Hacker News, r/vibecoding, the Lovable and Bolt communities.

Two constraints shaped it, and both are load-bearing. **Every number is our own
tool's**, not a competitor's. **No target is named**, because several findings are
real and unfixed.

---

## The short version

We built a static scanner for vibe-coded apps — the Lovable / Bolt / v0 / Cursor
stack on Supabase. It looks for the things that actually leak: `service_role`
keys in client bundles, tables with Row Level Security switched off, admin routes
with no auth, open CORS.

It ran a sweep and reported **19 repositories with CRITICAL findings.**

We re-audited 20 repositories by hand from fresh clones. **Four had a real
exposed secret.** The other fifteen headlines did not survive contact with the
code.

**What that is not: a 78% false-positive rate.** The other fifteen were not
clean. Most had real missing-RLS findings — genuinely unprotected tables, worth
fixing. What failed was the **headline**: the severity ranking that put all
nineteen in the same CRITICAL bucket as an exposed `service_role` key, and the
arithmetic underneath it. A true finding, counted wrongly and ranked wrongly, is
a different failure from a finding that isn't there, and conflating the two
would be the same inflation in the opposite direction.

We are publishing the gap because we have not seen anyone else publish theirs,
and because the specific ways a scanner is wrong turn out to be more useful than
the fact that it is.

## The four ways it lied

Each row is a measurement, not an estimate. Each is our own detector.

### 1. Counting findings instead of problems — 70 criticals, one cause

The missing-RLS detector emits **one finding per unprotected table.** One
`schema.current.sql` dump where nobody ran `ENABLE ROW LEVEL SECURITY` became
**seventy CRITICAL findings** in the report.

Seventy is not a lie about the code — every one of those tables really is
unprotected. It is a lie about the *work*. The developer reading "70 criticals"
thinks they have weeks of remediation. They have one migration.

**The fix:** report distinct problems and distinct files, never the raw total. A
count without a unit is not a count.

### 2. Grepping for auth instead of understanding it — 6 of 6 false

The unauthenticated-admin-route detector scanned admin route files for
auth-shaped tokens: `auth`, `session`, `requireAuth`, `getServerSession`.

One codebase had six admin routes and the detector flagged **all six**. All six
were guarded. They called a helper:

```js
requireSuperAdmin(req)
```

`requireSuperAdmin` contains none of the words the detector looked for, and
"unauthenticated" appearing in an error string does not match a `\bauth\b`
pattern. The detector did not miss a subtle bypass — it missed the single most
common way a competent team writes authorisation, which is **once, in a helper,
called everywhere.**

The cruel part: **any codebase that centralises its auth check trips this.** The
better the codebase, the more likely the false positive.

**The fix:** look for delegated guards — a call to `require*`, `assert*`,
`ensure*`, `verify*`, `check*`, `validate*`, or anything named `*Guard`,
`*Permission`, `*Authoriz*` — before claiming a route is naked. The call matters,
not the import: a helper imported and never invoked protects nothing.

### 3. Flagging code no attacker can reach — 4 of 4 unreachable

Four `command-injection` findings in one repository. All four were real string
interpolation into a shell command. All four interpolated **`process.env`
values, in a local script that no HTTP request touches.**

There is no untrusted input. There is no request path. It is a developer's own
environment variable going into a developer's own script on a developer's own
machine.

**The fix:** a reachability check before an injection finding is reported. Can
untrusted input actually get here? Code in a build script, a CLI or a test
fixture is not an attack surface, and reporting it as one is how a report earns
the label "noise".

### 4. Being right but stale

Supabase auto-revokes keys it detects as leaked. A finding can be dead before
anyone reads it. Disclosing a key that was rotated last week is worse than saying
nothing — it is the fastest way to be dismissed by someone who checked.

**The fix:** stamp every finding with when it was observed, and re-verify before
it reaches a human. Freshness is part of correctness.

## What *was* real

This is not an argument that vibe-coded apps are fine. They are not, and our
re-audit made the real findings sharper, not softer:

- **Four repositories had a genuine exposed secret** present in the source. One
  had nine. We did not test whether any of them still worked — that would mean
  using someone else's credential, which we will not do. Present in a public
  repo is enough to report; "exploitable" is a claim we have not earned.
- **The missing-RLS findings were true** — the seventy tables really were
  unprotected. Only the arithmetic was misleading.
- The independent numbers hold up: a June 2026 crawl of 1,072 Supabase-backed
  vibe-coded apps found **98% with at least one issue, 16% critical.**
  **CVE-2025-48757** hit 170+ Lovable apps on exactly the RLS pattern above.

**The problem is real. The reports about it are inflated.** Those are different
claims and both are true at once.

## Why this is worth your attention if you got a scary scan

A scanner that says "80 issues" when you have three is not a minor annoyance. It
is worse than silence, for a specific reason: **you cannot triage it.** You do
not know which three, you have no way to tell signal from padding, and after the
second false alarm you stop reading the reports — including the one that
mattered.

If you are holding a frightening report right now, three questions sort most of
it in ten minutes:

1. **How many distinct files and distinct causes?** Not how many findings. One
   migration repeated across a schema dump is one problem.
2. **Is there a guard the tool didn't look for?** Open the route. Search for a
   helper name. Centralised auth reads as absent auth to a grep.
3. **Can an untrusted request actually reach it?** If the code runs in a build
   script or a local CLI, nobody outside can touch it.

For a Supabase app specifically, the one query worth running before anything
else:

```sql
select tablename
from pg_tables
where schemaname = 'public'
  and rowsecurity = false;
```

Empty result: RLS is on everywhere. Rows returned: that list — not the scanner's
total — is your actual work.

## Why we published our own miss rate

Because the alternative was publishing the headline. We had a number —
"19 critical" — that would have looked good in exactly the way this whole
category looks good, and it was wrong by 15.

The first thing a competent developer does with a security email is check the
number. An inflated count is not a small embarrassment; it ends that conversation
and, because they will say so publicly, the cheap ones after it.

So the accuracy work is not diligence around the product. **It is the product.**
Anyone can generate findings; the market price for generating findings is now
approximately zero. What is scarce is a report where every line survived someone
trying to kill it.

---

*We do read-only static analysis of public code. We never touch a running
system, never use a credential we find, and never pull data through a hole we
report. Findings go to owners privately and free; no target is named here,
because several of these are real and unfixed.*
