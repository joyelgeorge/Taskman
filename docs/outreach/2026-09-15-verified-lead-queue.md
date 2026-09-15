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
| 1 | `Chalmers007/ordering-platform` | **9** | 6 no-auth admin routes, 5 missing-RLS | Strongest target on the board |
| 2 | `themosthappypiano/thewoofingoven` | **2** | 2 missing-table | |
| 3 | `danielphillippe27-netizen/flyrpro` | **1** | 70 missing-RLS / 12 files, 2 ssrf | Draft already written, not sent |
| 4 | `asjames18/melanatedintech` | **1** | 1 no-auth admin route, 3 missing-RLS | |
| 5 | `Harshanandhan/yt-repurposer-web` | **1** | — | Single clean finding |

### Different class, still serious

| Repo | Finding |
|---|---|
| `celljprimevini-eng/fortixx-saas` | **5 command-injection** |
| `afintech510/easternLM` | 14 unauthenticated admin routes |
| `Mehdi-Safraoui/lms-platform` | 4 unauthenticated admin routes |

### Verified as missing-RLS only — zero secrets

`lepefy-labs/lepefy-food-platform` (17), `zohaib-119/country-rise-we` (12),
`Jpalmer95/kynda-coffee` (10), `BeaconBandhu/azaisai-rebuild` (6),
`adityash8/jetpast` (4), `NtFelix/RMS` (2 + 2 ssrf), `rakshithp7/HESTIA` (2),
`TrustLoop-By-N3K0/TrustLoop` (2), `Marstronix218/indobiz_japan` (2),
`BalaShankar9/CarpoolNetwork` (1), `afintech510/maningo-method` (1),
`Ostive/Health-Invoice` (1).

These are real findings and a real offer, but they are **not** "your key is
public" emergencies and must not be pitched as such.

### Not verified

`Addy48/AIIMIN`, `shipking-ai/AuraMind-App-2`, and a re-check of
`danielphillippe27-netizen/flyrpro`. All three are **public and live** — the
clones failed on `No space left on device`, not on the repositories. 137 MB,
219 MB and 442 MB respectively; check free space before retrying.

## Status

**Nothing has been sent.** The operator sends; Claude drafts and logs. Log each
attempt with `npm run outreach -- log` — see the `send-and-log-outreach` skill.

These counts are not yet in `research_notes` because this session had no
`DATABASE_URL`. Record them when one is available rather than re-deriving them.
