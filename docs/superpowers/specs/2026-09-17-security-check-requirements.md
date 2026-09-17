# End-to-end requirements for a security check

Written 2026-09-17. **Independent of the current implementation**: every
requirement below is derived from a failure this project has actually measured,
not from a generic checklist. Where a requirement contradicts what the code does
today, the requirement is what is meant and the code is wrong.

Scope is the whole chain — from admitting a target to proving a fix worked —
because every competitor counted on 2026-09-17 implements only stage 3, and the
stages either side of it are where this project's own findings have failed.

This spec produces no settlement row. It is level 4.

---

## The failures it is written against

All measured in this repository, all dated:

| # | Observed | Where |
|---|---|---|
| F1 | **19 CRITICAL leads → 4 real** exposed secrets on re-audit. ~5x inflation, always flattering. | `verify-lead-before-contact`, 2026-09-15 |
| F2 | **One systemic issue became 70 criticals** — `missing-rls` emits once per table, so a single unprotected `schema.current.sql` counts seventy times. | same |
| F3 | **6/6 admin routes falsely flagged** — a `requireSuperAdmin()` helper the adversarial pass never looked for. | `expanding-the-search` |
| F4 | A "command injection" in a **local script no request reaches**. | flyrpro, same |
| F5 | **Supabase auto-revokes leaked keys**; a finding can be dead before it is sent. | `expanding-the-search` |
| F6 | A perfect finding **in a template** (`thread-and-form-store`) — wasted disclosure. | same |
| F7 | Scanning is **free at the bottom** and 13 competitors exist; being another scanner is not a product. | 2026-09-17 price research |

Note what F1–F4 have in common: **none is a missed vulnerability.** Every one is
the system saying something is true that is not. For this lane the expensive
error is the false positive, because the first thing a competent developer does
with the email is check the number — and they say so publicly when it is wrong.

---

## R1 — Target admission

**R1.1** A target MUST be classified as *operating business* or *not* before any
detector runs, and a non-business MUST NOT consume a scan slot. (F6)

**R1.2** Classification MUST require **multiple independent signals**, never one.
The strongest single signal is a custom domain serving a working storefront with
real prices — it costs money nobody spends on a demo. Repo age and cadence, repo
size, live checkout, and real contact details are corroborating.

**R1.3** Classification MUST use **only the public storefront** — pages any
customer sees. No admin endpoint, no request crafted to test a finding.

**R1.4** A target MUST be recorded as scanned with its outcome, so a second sweep
does not re-derive it. Deduplication is a requirement, not an optimisation: the
2026-09-12 sweep exhausted its pool and the next run found zero new candidates.

## R2 — Acquisition surface

**R2.1** The system MUST support **at least two independent surfaces** for the
same target class. Repository source is one. Deployed bundles are the other, and
they are strictly better on two axes: they reflect what is actually shipped, and
they are immune to the repository never being public at all.

**R2.2** Acquisition MUST be **read-only and non-authenticating**. Clone or fetch
public artifacts; never supply credentials, never use a credential found in the
artifact, never pull data through an endpoint the finding says is unprotected.
This is the line between research and intrusion and it is not negotiable.

**R2.3** Acquired material MUST be deleted after analysis. Nothing about a third
party's code needs to persist beyond the finding's location and class.

**R2.4** When a surface is exhausted, the system MUST signal *exhausted* rather
than return an empty result indistinguishable from failure. (A query that had
matched zero repositories since it was written contributed nothing for weeks and
nothing said so.)

## R3 — Detection

**R3.1** Detectors MUST target the class that actually costs owners money:
exposed `service_role` keys, missing RLS, secrets in the client bundle, open
CORS, no-auth admin routes — CWE-284/200/312/942/798. Server-side injection is
explicitly **not** the priority class here.

**R3.2** Every finding MUST carry, at minimum: `kind`, `severity`, `file`,
`line`, and the **surface it came from**. A finding that cannot be pointed at is
not disclosable.

**R3.3** A detector MUST NOT store the secret value it found — not even
truncated. Class and location only. The evidence of a leaked key is its
location; reproducing the key is creating a second copy of the incident.

**R3.4** Detection MUST be cheap enough to run twice: once to find, once to
prove fixed (R8). A detector that can only be run by a human reading output does
not satisfy this.

## R4 — Refutation (the stage competitors do not have)

**R4.1** Every finding MUST be passed to at least one **refuter** before it can
be promoted. A refuter's job is to kill the claim, not to score it.

**R4.2** The refuters MUST include, at minimum:

- **Guard refuter** — is there a middleware, auth wrapper or delegated helper
  (`requireSuperAdmin()`) that already protects this? Absence of a guard *at the
  route* is not absence of a guard. (F3)
- **Reachability refuter** — can untrusted input actually reach this code? Code
  in a build script, a local CLI or a test fixture that no request touches is not
  a vulnerability. (F4)
- **Business refuter** — R1, re-checked at finding time rather than trusted from
  intake. (F6)

**R4.3** A **symbolic refutation MUST override any confidence score.** An AST
walk, a route-graph lint or a `pg_tables … rowsecurity` query that refutes a
claim kills it outright, however confident the generator was. Facts beat claims;
a threshold where a deterministic check exists is a defect.

**R4.4** When two perspectives **disagree** about one target, the system MUST
surface the disagreement and MUST NOT average it into a score. A contested
finding is never auto-promoted; it goes to a human, which is the cheapest place
to spend a minute. Averaging is how F3 would have shipped.

**R4.5** Refutation MUST run **before** a count is reported anywhere — dashboard,
log or message. A count that has not survived refutation is a count of findings,
not problems, and the two differ ~5x. (F1)

## R5 — Counting

**R5.1** A finding count MUST state its **unit**. "70 criticals" for one
unprotected schema dump is not wrong arithmetic, it is a missing unit. (F2)

**R5.2** The system MUST report **distinct problems** alongside raw findings, and
the distinct count is the one that may be shown to an outsider. Systemic issues
(one schema, one misconfiguration, one CORS policy) collapse to one problem
regardless of how many tables or files they touch.

**R5.3** A count that reaches a stranger MUST be **re-derived from a fresh
acquisition**, not read from a prior sweep's stored total. (F1)

## R6 — Temporal validity

**R6.1** Every finding MUST carry the timestamp it was observed.

**R6.2** A finding older than a stated freshness window MUST be **re-verified
before disclosure**, not sent. Supabase auto-revokes leaked keys; disclosing a
key that was rotated last week is the embarrassment that ends the conversation.
(F5)

**R6.3** Re-verification MUST use the same read-only constraint as R2.2. The
check is "is this still present in the public artifact", never "does this
credential still work".

## R7 — Disclosure

**R7.1** A disclosure MUST be **drafted by the system and sent by a human.**
Nothing reaches a person without an operator action. This is an invariant, not a
setting.

**R7.2** A disclosure MUST contain enough for the owner to act — class, location,
what an attacker could reach — and **never a public recipe**.

**R7.3** The disclosure MUST be **free and unconditional.** Any paid offer is for
the fix, is separate, and MUST NOT be a condition of receiving the finding.

**R7.4** Every send MUST be logged with lane, channel, prospect and outcome. An
unlogged send leaves the lane indistinguishable from untried, and when "we tried
and it failed" and "nobody tried" cannot be told apart, the default is always to
build more supply.

**R7.5** At most one follow-up. Two is spam and costs more than the lead.

## R8 — Fix and proof

**R8.1** The product is the **fix**, not the scan. R7.3 gives the scan away; the
market prices scanning at zero. (F7)

**R8.2** A delivered fix MUST ship with **proof it worked**: the same detector,
run again on the same surface, showing the finding absent — with both runs
timestamped and attributable.

**R8.3** Proof MUST be reproducible by the customer. "We checked" is the claim
this whole spec exists to distrust; hand over something they can re-run.

**R8.4** The fix MUST NOT be applied to a system this project does not own.
Deliver the patch and the proof method; the owner applies it.

## R9 — Settlement

**R9.1** Money MUST enter only through `recordSettlement`, with a verified
source and an `externalRef` an outside system can confirm.

**R9.2** A settlement MUST NOT be recorded as cleared without a **confirmation
naming something outside this process that observed the money** — provider API,
bank statement, or an operator receipt marked as the weakest evidence. A
plausible-looking reference is not an observation. (Added 2026-09-14 after a $220
settlement for a customer who did not exist passed the guard.)

**R9.3** An unreadable store MUST report `UNKNOWN`, never `0`. Absence of
evidence is not evidence of zero — in either direction.

---

## What this implies that the current system does not do

Stated plainly so the gap is visible rather than implied:

1. **R4.2's guard refuter exists, inside one detector, and nowhere else.**
   Checked rather than assumed: `findUnauthenticatedAdminRoutes`
   (`codebase-audit.js:500–516`) was fixed after F3 and now tests for delegated
   guards — `hasDelegatedGuard` matches `require|assert|ensure|verify|check|validate`
   followed by a capital, plus `*Guard|*Permission|*Authoriz*`, with the comment
   recording the Chalmers007 measurement and the reason (`requireSuperAdmin`
   contains none of the literal auth words). That is the right fix and it is real.

   What is missing is that this is **one detector's private defence, not a
   stage.** It does not generalise: a second detector making a claim that a guard
   would refute gets no such check, and nothing composes refuters across
   detectors or records that a refutation happened. R4 asks for refutation as a
   pipeline stage with its own output; what exists is one hard-won conditional.
   **The reachability refuter is built as of 2026-09-17** —
   `packages/core/findings/reachability.js`, honouring R4.3 (a deterministic
   refutation kills the claim, no score) and R4.4 (disagreement surfaces as
   `contested` rather than averaging). The finding-time business refuter (F6)
   still has no implementation.
2. ~~**R5.2 does not exist.**~~ **Built 2026-09-17** —
   `packages/core/findings/report.js`. `summarizeFindings()` collapses raw
   findings to problems per (kind, file) and reports the inflation factor;
   `headline()` refuses to quote a raw total alone. The flyrpro case now reads
   as **13 problems across 13 files (71 raw findings)** instead of "71
   criticals". Guard-verified: reporting raw findings as problems turns two
   tests red.
3. **R6 does not exist.** No finding carries an observation timestamp, so no
   freshness window can be enforced.
4. **R2.1 is unmet.** Repository source is the only surface. The bundle surface
   is named in `expanding-the-search` and pointed at a `scan-bundles` skill
   **that does not exist** — and a session on 2026-09-17 could not run the repo
   surface at all, because cloning third-party repos is refused here while
   fetching a public bundle would not have been.
5. ~~**R8.2 has no implementation.**~~ **Built 2026-09-17** — `proveFixed()` in
   the same module diffs a before/after scan into fixed / remaining /
   introduced, and only an empty remainder **and** an empty introduced set reads
   as `clean`. This is the thing the agency offer calls the deliverable, and it
   was being sold before it existed. Guard-verified: letting `clean` ignore
   newly introduced findings turns a test red.

## The commercial reading

R4, R5 and R6 are the entire differentiator, and they are the three the market
does not sell. Thirteen competitors ship stage 3 — detection — and scanning is
free at the bottom. **Nobody sells a scan that has tried to prove itself wrong.**

That matters because the measured failure mode of this category is not missing a
bug, it is crying wolf: 19 → 4. A scanner whose numbers survive a developer
checking them is a different product from a scanner that is cheap, and it is the
one axis in this market not racing to zero — being right does not commoditise the
way scanning has.

It is also a *trust* property rather than a code property, which is the class of
barrier the 2026-09-13 research found holds price while everything else falls to
marginal cost.

**Unvalidated:** that anyone pays more for a lower false-positive rate. That is a
demand question, and per this repository's own rule it must be answered before
any of R4–R6 is built at scale, not after.
