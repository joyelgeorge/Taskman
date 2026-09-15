# The revenue-job runner, and the four gates that justify it

**Priority: P2. Phase 3 of the accumulating-architecture spec. Progress level 4.**
Raised 2026-09-15.

## What

`packages/core/jobs/runner.js` executes a job descriptor's stages under four
gates, plus migration `035_job_runs.sql` and its memory-mode mirror
(`CLAUDE.md` rule 4: dual storage, numbered migration, schema-agreement test).

| Gate | Rule |
|---|---|
| **Human** | `intervene` refuses to run without an explicit operator approval token |
| **Evidence** | `charge` refuses unless `verify` returned external evidence (`assertClaimAllowed`) |
| **Ledger** | `charge` has exactly one write path: `recordSettlement` |
| **Attempt** | every stage run is logged **before** it returns |

## Why a runner rather than a third bespoke module

`src/audit-fulfilment.js` (126 lines) and `src/scan-fulfilment.js` (156 lines)
are the same shape written twice, sharing no contract. A third revenue job means
a third hand-written file and a third place for a gate to be forgotten.

**The attempt gate is the real justification.** `docs/WHY-NO-MONEY-YET.md` found
that nothing counted attempts, so no lane could be honestly proven or retired —
and `KILL_AFTER_ATTEMPTS` and `breakEvenRateFor` were written to consume data
nothing was producing. A runner that logs every stage makes *"did we ever
actually try?"* answerable by construction.

Without that gate this is a for-loop with ceremony, and should not be built.

## Testing, non-negotiable

The human gate and the evidence gate get **mutation tests**: remove the gate, and
the test must fail. A guard that has not been broken is not a guard
(`.claude/skills/verifying-guard-tests/`, and four vacuous-guard incidents in one
session are the reason that skill exists).

## Done looks like

A job cannot charge without verified evidence, and cannot intervene without an
approval token, each proven by deleting the check and watching a test go red.
