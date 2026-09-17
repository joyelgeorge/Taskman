/**
 * Runs a revenue job's stages under four gates.
 *
 * Without the gates this is a for-loop with ceremony and should not exist. The
 * one that justifies building it is the attempt log: docs/WHY-NO-MONEY-YET.md
 * found that nothing in this repository ever counted an attempt, so no lane
 * could be honestly proven or retired — and KILL_AFTER_ATTEMPTS and
 * breakEvenRateFor were both written to consume data nothing was producing.
 * With no count, "we tried and it did not work" and "nobody tried" are
 * indistinguishable from inside the repo, and the default is always to build,
 * because building is the half that can be observed.
 *
 *   1. HUMAN     intervene will not run without an operator approval token.
 *   2. EVIDENCE  charge will not run unless verify produced a checkable
 *                external reference.
 *   3. LEDGER    the charge stage DESCRIBES a settlement and the runner writes
 *                it, through money-ledger and nowhere else. A job that could
 *                write its own ledger row would make every other gate
 *                decorative, so the job never gets to.
 *   4. ATTEMPT   every stage run is written to the log BEFORE its result is
 *                returned, including refusals and failures.
 *
 * A refusal is a normal outcome, not an error. It is the machine doing its job,
 * and it is recorded as carefully as a success — a gate that stops something
 * silently teaches nobody anything.
 */

import { JOB_STAGE } from './job-spec.js';
import { hasVerifiableReference } from '../../../src/evidence-tier.js';
import { recordJobRun } from '../../../src/job-run-log.js';
import { recordSettlement } from '../../../src/money-ledger.js';

export const STAGE_OUTCOME = Object.freeze({
  OK: 'OK',
  REFUSED: 'REFUSED',
  FAILED: 'FAILED'
});

/**
 * Stages a machine may not perform alone. Only intervene: it is the one that
 * reaches a person — a message, a draft sent, a change proposed outside this
 * process. CLAUDE.md rule 2 and every disclosure draft in docs/outreach depend
 * on this staying true.
 */
export const APPROVAL_REQUIRED = Object.freeze(new Set([JOB_STAGE.INTERVENE]));

/** The order a wedge actually runs in. */
export const STAGE_ORDER = Object.freeze([
  JOB_STAGE.CONNECT, JOB_STAGE.LISTEN, JOB_STAGE.DETECT, JOB_STAGE.INTERVENE,
  JOB_STAGE.VERIFY, JOB_STAGE.MEASURE, JOB_STAGE.CHARGE
]);

const nowIso = () => new Date().toISOString();

/**
 * Run one stage.
 *
 * `log` is injected so the attempt record is a dependency rather than a side
 * effect nobody can see in a test — and so a test can prove the write happens
 * before the return, which is the part that matters.
 */
export async function runStage(job, stage, { approval = null, context = {}, log = recordJobRun, settle = recordSettlement, now = nowIso } = {}) {
  const started = typeof now === 'function' ? now() : nowIso();

  const finish = async (outcome, { reason = null, result = null } = {}) => {
    const row = {
      job: job?.key ?? '(no key)',
      rail: job?.rail ?? null,
      stage,
      outcome,
      reason,
      approval: approval ?? null,
      at: started
    };
    // Gate 4. Before the return, so a caller cannot observe a stage that the
    // log never saw — including when the stage threw.
    if (typeof log === 'function') await log(row);
    return { ...row, result };
  };

  const implementation = job?.stages?.[stage];
  if (typeof implementation !== 'function') {
    return finish(STAGE_OUTCOME.REFUSED, {
      reason: `job does not declare a "${stage}" stage — an absent stage is not a completed one`
    });
  }

  // Gate 1.
  if (APPROVAL_REQUIRED.has(stage) && !approval) {
    return finish(STAGE_OUTCOME.REFUSED, {
      reason: `"${stage}" reaches a person and needs an operator approval token; the machine prepares, a human decides`
    });
  }

  // Gate 2. `verify` is what produces the evidence, so `charge` asks for what it
  // left behind rather than trusting that it ran.
  if (stage === JOB_STAGE.CHARGE) {
    const evidence = context?.evidence ?? null;
    const reference = hasVerifiableReference({
      externalRef: evidence?.externalRef, source: evidence?.source, url: evidence?.url
    });
    if (!reference.ok) {
      return finish(STAGE_OUTCOME.REFUSED, {
        reason: `cannot charge without a checkable external reference from verify: ${reference.reason}`
      });
    }
  }

  try {
    const result = await implementation({ job, context, approval });

    // Gate 3. charge returns a description of money; the runner is what records
    // it. The job is never handed recordSettlement, so there is no path from a
    // job body to the ledger that does not pass through here.
    if (stage === JOB_STAGE.CHARGE) {
      if (!result || !result.externalRef) {
        return finish(STAGE_OUTCOME.FAILED, {
          reason: 'charge returned no settlement to record — a charge that describes no money is not a charge'
        });
      }
      const recorded = await settle({ rail: job?.rail ?? null, ...result });
      return finish(STAGE_OUTCOME.OK, { result: recorded });
    }

    return finish(STAGE_OUTCOME.OK, { result });
  } catch (error) {
    return finish(STAGE_OUTCOME.FAILED, { reason: String(error?.message || error) });
  }
}

/**
 * Run the declared stages in order, stopping at the first refusal or failure.
 *
 * Stopping rather than skipping is deliberate: a run that carries on past a
 * refused intervene would reach verify and charge for work no person ever
 * approved, which is the exact shape of the failure the gates exist to prevent.
 */
export async function runJob(job, { approval = null, context = {}, log = recordJobRun, settle = recordSettlement, now = nowIso } = {}) {
  const runs = [];
  const shared = { ...context };
  let stopped = null;

  for (const stage of STAGE_ORDER) {
    if (typeof job?.stages?.[stage] !== 'function') continue;

    const run = await runStage(job, stage, { approval, context: shared, log, settle, now });
    runs.push(run);

    if (run.outcome !== STAGE_OUTCOME.OK) { stopped = stage; break; }

    // Each stage's result is visible to the stages after it, under its own name,
    // so a job reads `context.detect` rather than smuggling state through a
    // closure the gates cannot see.
    shared[stage] = run.result ?? null;

    // verify hands its evidence to charge. Nothing else may put it there.
    if (stage === JOB_STAGE.VERIFY) shared.evidence = run.result ?? null;
    if (stage === JOB_STAGE.MEASURE) shared.measured = run.result ?? null;
  }

  return {
    job: job?.key ?? '(no key)',
    runs,
    stopped,
    charged: runs.some(r => r.stage === JOB_STAGE.CHARGE && r.outcome === STAGE_OUTCOME.OK)
  };
}
