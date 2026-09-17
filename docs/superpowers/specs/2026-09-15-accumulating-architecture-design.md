# Accumulating architecture: never re-derive, never hallucinate, always recover

**Status: design, not built.** 2026-09-15.

## The problem, stated once

Work here is done in sessions that end. Each new session starts with no memory
and reconstructs the position by reading whatever is nearest — a commit message,
a dashboard, a previous model's summary. Three things follow, and all three have
already happened in this repository:

1. **Re-derivation.** Capability is rebuilt because nobody knew it existed.
   Twice the answer has been *"yes, and it is disconnected by one import."*
2. **Evaporation.** A research pass produces a real finding in a transcript, the
   transcript ends, and the finding is gone. The vibe-app sweep wrote its results
   to `/tmp` and lost them.
3. **Drift into fabrication.** A number written down once is quoted forever
   without being re-checked. `docs/tasks/` and the disclosure drafts exist
   because a "71 critical findings" headline turned out to be one systemic issue
   counted seventy times.

The fix is not discipline. Discipline is what fails at 2am in week three. The fix
is that **every store answers for itself, and the machine reconstructs the
position rather than recalling it.**

## The anchor finding

Verified 2026-09-15 against `src/money-ledger.js:299`:

```js
export async function listSettlements({ rail = null, limit = 200 } = {}) {
  if (!databaseEnabled) {
    return memory.settlements...      // empty array on a fresh boot
  }
```

With no `DATABASE_URL`, asking *"how much money have we made?"* returns `[]` —
**indistinguishable from a reachable database holding zero rows.**

Today this is harmless because the true answer is zero either way. The day a
settlement exists, a session without the secret reports $0 and is confidently
wrong, and every downstream claim inherits the error.

This is the hallucination vector in its purest form, it is in live code, and it
is one boolean away from being correct. Everything below generalises it.

## The rule

> **Every prompt and every research pass must leave a durable artifact in a
> ground-truth store, and any claim must name the store it came from.**

Adding a task is therefore progress, not overhead: a parked task is a finding
that survived the session that found it. So is a recorded research note, a
logged attempt, a verdict with a reason. These accumulate; prose in a transcript
does not.

## Ground-truth stores, and what each one answers for

Four stores. Each is authoritative for exactly one kind of question, and no
store is trusted outside its remit.

| Store | Authoritative for | Recovers |
|---|---|---|
| **Git** | What changed, when, and in what order | Code, docs, migrations — everything but live rows |
| **Docs** (`READ-FIRST`, `tasks/`, `BRAIN-TRANSFER` §14) | *Why*, and what not to try again | Intent, decisions, dead ends with reasons |
| **Postgres** | Facts with numbers: settlements, leads, outreach attempts, scanned repos, job runs | The live position |
| **Registry code** (`territory/registry.js`, `evidence-tier.js`) | Verdicts and their reasons | What is live, unproven, killed |

A claim about money cites Postgres. A claim about what was tried cites the
registry. A claim about why cites docs. A claim citing a previous model response
cites nothing.

## Layers

### L0 — Stores
The four above. Unchanged in kind; this design only adds `research_notes` and
`job_runs`, and gives every store a way to say *"I could not answer."*

### L1 — Boot and recovery: `npm run brief`

One command that reconstructs the verified position and prints it. A session
starts by running it, not by remembering.

It reports: settlement count and total, open and closed tasks, outreach attempts
by lane and outcome, leads and criticals, scanned-repo count, active territories,
last five commits, and pending migrations.

**Its hard requirement is the anchor finding's fix:** every line is labelled
`verified`, `empty`, or **`UNKNOWN — store unreachable`**. It must never print a
zero it cannot stand behind. A `brief` that cannot reach Postgres says so on
every row that needs Postgres, and exits non-zero.

`scripts/preflight.js` validates configuration only; it does not report position.
`brief` is new.

### L2 — Accumulation

- **`research_notes`** (new table + `docs/research/` mirror so git holds it too):
  claim, evidence tier from `src/evidence-tier.js`, the source — a URL, a command
  and its output, a file and line — and when. A research pass that produces no
  note produced nothing.
- **`job_runs`** (new table): every stage attempt of every revenue job, written
  *before* the stage returns. This is what makes "did we ever actually try?"
  answerable, and it feeds `KILL_AFTER_ATTEMPTS` and `breakEvenRateFor`, which
  were written to consume data nothing was producing.
- **Tasks become countable.** `docs/tasks/*.md` gain YAML front-matter — id,
  status, priority, opened, closed, progress level — so the index is generated
  rather than hand-maintained, and `brief` can count them. The prose body stays
  exactly as it is; it is the part a human reads.
- **`outreach_attempts`** already exists and is the model the rest copies.

### L3 — Execution: the revenue-job runner

Revenue jobs become descriptors merged into `EXPLORED_TERRITORIES`, carrying
`{distribution, economics, rail, stages}` alongside the existing
`{key, verdict, note}`. Stages are `connect, listen, detect, intervene, verify,
measure, charge`; absence is meaningful and enforced — no `verify` means the job
can never reach `charge`.

The runner in `packages/core/jobs/runner.js` enforces four gates:

| Gate | Rule |
|---|---|
| Human | `intervene` refuses to run without an explicit operator approval token |
| Evidence | `charge` refuses unless `verify` returned external evidence (`assertClaimAllowed`) |
| Ledger | `charge` has exactly one write path: `recordSettlement` |
| Attempt | every stage run is logged before it returns |

The scorer is reworked so the ranking principle adopted on 2026-09-14 is encoded
rather than remembered: `distribution` rises from weight 0.15 to 0.35, gains the
value `relationship_exists: 1` it currently cannot express, and
`must_create_demand` caps the composite instead of merely lowering it.

### L4 — Verification: agreement tests

`test/schema-code-agreement.test.js` already proves the schema matches what the
code writes. Generalise the idea:

**Claim–reality agreement.** Numbers asserted in `READ-FIRST.md` and `README.md`
are checked by a test. "Six code paths can record a settlement" is a grep with a
count. "`settlements` is empty" is a query — and a test that *fails when it stops
being true*, which is the happiest failure this repository could have.

READ-FIRST already says a drifted read-first document is worse than none. This
makes that structural.

## Invariants

Numbered so they can be cited, and each one testable.

1. **Empty is not unknown.** No store read may report zero for a store it could
   not reach.
2. **Every claim names a source.** Research notes carry an evidence tier; an
   unsourced claim is a hypothesis and is labelled one.
3. **Docs that assert numbers are tested.**
4. **Every attempt is logged before it is reported.**
5. **Money has exactly one write path**, and it refuses self-reported income.
6. **A human gates every external action.** The machine prepares; a person sends.
7. **Nothing is deleted; verdicts carry reasons.** A killed lane keeps why.
8. **A task is a record, not a memory.**

## Roadmap

Phases are ordered by how much hallucination they remove per unit of work, and
labelled with the `READ-FIRST` progress level they target. Only level 1 is the
goal; the rest is maintenance and must be called that.

| Phase | Work | Exit criterion | Level |
|---|---|---|---|
| **0** ✅ | `npm run brief` + the empty-vs-unreachable fix | A session with no `DATABASE_URL` cannot be told the revenue is $0 | 4 |
| **1** ✅ | `research_notes`, task front-matter, generated index | A finding from a past session is retrievable without its transcript | 4 |
| **2** ✅ | Job descriptors merged into the registry; scorer rework | The scorer ranks the Tally wedge above a cold lane | 4 |
| **3** ✅ | Runner, four gates, `036_job_runs.sql`, mutation tests | A job cannot charge without verified evidence, proven by breaking it | 4 |
| **4** (open, do last) | Refactor `audit-fulfilment` and `scan-fulfilment` onto the contract | Both still pass, unchanged in behaviour | 4 |
| **5** ✅ | Claim–reality agreement tests | READ-FIRST cannot drift silently | 4 |

Phase 0 is worth more than phases 2–5 combined for the stated goal and is the
smallest. Phase 4 is last because it touches the only two finished settlement
paths; if it fights, stop and leave them alone.

## Recovery procedures

- **Cold start.** `npm run brief`, then read `docs/READ-FIRST.md`, then
  `docs/tasks/README.md`. Nothing else is required and nothing else is trusted.
- **Database lost.** Git holds migrations, docs, registries and research mirrors.
  Re-run `npm run migrate`. Settlements and attempt history are *not*
  reconstructible — which is the argument for the `docs/research/` mirror and for
  external references on every settlement row.
- **Docs drifted.** The agreement tests fail and name the drifted claim. Correct
  the doc in the same commit as whatever made it wrong.
- **Two sessions in one tree.** Unchanged and already working: park a task rather
  than block, and never edit a file another session is mid-edit in.

## What this is not

No scheduler, no dashboard, no multi-tenancy, no retry policy, no agent memory
service. Stages are called; nothing runs itself on a timer. Every piece here
exists to make a later session correct, not to make the machine autonomous.

## Honest accounting

This is progress level 4 in its entirety. It produces no settlement row and no
named human who has seen the offer. It is justified only because sessions will
keep happening and each one currently pays a re-derivation tax, and because
invariant 1 is a live correctness bug rather than a refinement.

That justification does not extend to phases 2 through 5 if the Tally wedge or
the outreach lane needs the time instead. **Revenue work outranks this document.**
