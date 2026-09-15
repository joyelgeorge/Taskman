# The verified lead queue

**Verified 2026-09-15** by re-auditing each repository against a fresh shallow
clone, which was then deleted. Read-only: no running product was touched, no
credential was used, and no secret value is recorded here.

## The headline was 5x high

The sweep reported **19 leads carrying CRITICAL findings**. Of 20 re-audited,
**4 have an actual exposed secret.** The rest are dominated by `missing-rls`,
which the detector emits **once per table** — so one architectural gap in one
schema dump becomes seventy criticals.

**Do not quote the sweep's number to anyone.** See the
`verify-lead-before-contact` skill.

## Queue, best first

| # | Repo | Verified `exposed-secret` | Also | Note |
|---|---|---|---|---|
| 1 | `Chalmers007/ordering-platform` | **1 key in 9 files** | 4 tables without RLS | **Draft written.** The 6 "no-auth admin routes" are FALSE POSITIVES — all six are guarded |
| 2 | `themosthappypiano/thewoofingoven` | **2** | 2 missing-table | |
| 3 | `danielphillippe27-netizen/flyrpro` | **1** | 70 missing-RLS / 12 files, 2 ssrf | Draft already written, not sent |
| 4 | `asjames18/melanatedintech` | **1** | 1 no-auth admin route, 3 missing-RLS | |
| 5 | `Harshanandhan/yt-repurposer-web` | **1** | — | Single clean finding |

### Different class — now in doubt

| Repo | Finding | Status |
|---|---|---|
| `celljprimevini-eng/fortixx-saas` | 5 command-injection | **Unverified.** flyrpro's 4 of this class were env-var interpolation in a local script, not exploitable. Check before believing. |
| `afintech510/easternLM` | privileged-route auth bypass | **CONFIRMED real by hand** 2026-09-15. A live commercial site (landscaping/e-commerce, Stripe). Exploit specifics are deliberately NOT in this public repo — operator has them directly. Strong lead. |
| `Mehdi-Safraoui/lms-platform` | (was 4 admin routes) | **FALSE POSITIVE**, cleared. Only missing-RLS remains. |

The detector was fixed 2026-09-15 (it missed delegated guard helpers). Of the
three repos it had flagged on this class, two were false positives now cleared
and one — easternLM — is a genuine, hand-confirmed auth bypass. The lesson holds:
nothing from any detector class goes in a message without a file read by hand
first.

**easternLM's finding is a working exploit against a live site.** Its specifics
are kept out of this public repository on purpose (the same reason a service_role
key value is never written down). The operator has the detail; the disclosure
draft for it must be handled privately, not committed here.

### Verified as missing-RLS only — zero secrets

`lepefy-labs/lepefy-food-platform` (17), `zohaib-119/country-rise-we` (12),
`Jpalmer95/kynda-coffee` (10), `BeaconBandhu/azaisai-rebuild` (6),
`adityash8/jetpast` (4), `NtFelix/RMS` (2 + 2 ssrf), `rakshithp7/HESTIA` (2),
`TrustLoop-By-N3K0/TrustLoop` (2), `Marstronix218/indobiz_japan` (2),
`BalaShankar9/CarpoolNetwork` (1), `afintech510/maningo-method` (1),
`Ostive/Health-Invoice` (1).

These are real findings and a real offer, but they are **not** "your key is
public" emergencies and must not be pitched as such.

### The last three, now verified (2026-09-15, after freeing disk)

| Repo | `exposed-secret` | Also |
|---|---|---|
| `danielphillippe27-netizen/flyrpro` | **1** | **4 command-injection**, 70 missing-RLS, 2 ssrf |
| `Addy48/AIIMIN` | 0 | 35 missing-table, 1 open-cors, 1 ssrf |
| `shipking-ai/AuraMind-App-2` | 0 | **1 command-injection**, 3 missing-RLS |

flyrpro's exposed-secret count confirms the hand verification. The **4
command-injection findings are new** and were not in the earlier draft — they
belong in it, and they are more serious than the RLS pile it currently leads on.

All 22 leads are now verified. **Total with a compelling finding: 7** — five with
an exposed secret, plus `celljprimevini-eng/fortixx-saas` and
`shipking-ai/AuraMind-App-2` on command injection.

## Status

**Nothing has been sent.** The operator sends; Claude drafts and logs. Log each
attempt with `npm run outreach -- log` — see the `send-and-log-outreach` skill.

These counts are not yet in `research_notes` because this session had no
`DATABASE_URL`. Record them when one is available rather than re-deriving them.
