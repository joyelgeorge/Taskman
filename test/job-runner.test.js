import test from 'node:test';
import assert from 'node:assert/strict';
import { JOB_STAGE, DISTRIBUTION } from '../packages/core/jobs/job-spec.js';
import { runStage, runJob, STAGE_OUTCOME, APPROVAL_REQUIRED } from '../packages/core/jobs/runner.js';

function recorder() {
  const rows = [];
  return { rows, log: async (row) => { rows.push(row); return row; } };
}

const job = (stages) => ({
  key: 'test-job', verdict: 'unproven', note: 'a note long enough to explain itself',
  distribution: DISTRIBUTION.RELATIONSHIP_EXISTS, rail: 'test-rail', stages
});

// GATE 1 — human. CLAUDE.md: the agent prepares, a person decides.

test('intervene refuses to run without an operator approval token', async () => {
  let ran = false;
  const result = await runStage(job({ intervene: async () => { ran = true; } }), JOB_STAGE.INTERVENE,
    { log: recorder().log });

  assert.equal(result.outcome, STAGE_OUTCOME.REFUSED);
  assert.equal(ran, false, 'the stage body must not execute');
  assert.match(result.reason, /approval/i);
});

test('intervene runs when an operator approval token is supplied', async () => {
  let ran = false;
  const result = await runStage(job({ intervene: async () => { ran = true; return 'draft'; } }),
    JOB_STAGE.INTERVENE, { approval: 'operator:joyel', log: recorder().log });

  assert.equal(result.outcome, STAGE_OUTCOME.OK);
  assert.equal(ran, true);
});

test('a stage that is not intervene does not need approval', async () => {
  const result = await runStage(job({ detect: async () => ['a finding'] }), JOB_STAGE.DETECT,
    { log: recorder().log });

  assert.equal(result.outcome, STAGE_OUTCOME.OK);
});

// GATE 2 — evidence. charge needs something outside this process to be true.

test('charge refuses when verify produced no external evidence', async () => {
  let charged = false;
  const result = await runStage(
    job({ verify: async () => ({}), charge: async () => { charged = true; } }),
    JOB_STAGE.CHARGE, { approval: 'operator:joyel', context: {}, log: recorder().log });

  assert.equal(result.outcome, STAGE_OUTCOME.REFUSED);
  assert.equal(charged, false, 'money must not be taken for an outcome nothing checked');
  assert.match(result.reason, /evidence|reference/i);
});

test('charge runs when verify supplied a checkable external reference', async () => {
  let charged = false;
  const result = await runStage(
    job({
      verify: async () => ({}),
      // Gate 3: charge describes the money, it does not write it. Returning
      // anything else (a bare ok:true) is a charge that describes no money.
      charge: async () => {
        charged = true;
        return { source: 'bank', externalRef: 'UPI-8842190', grossCents: 50000, currency: 'INR' };
      }
    }),
    JOB_STAGE.CHARGE,
    { approval: 'operator:joyel', context: { evidence: { externalRef: 'UPI-8842190', source: 'bank' } },
      log: recorder().log, settle: async (s) => ({ id: 'settlement-1', ...s }) });

  assert.equal(result.outcome, STAGE_OUTCOME.OK);
  assert.equal(charged, true);
  assert.equal(result.result.id, 'settlement-1', 'the runner returns what the ledger recorded');
});

// GATE 4 — attempt. The count is the thing nothing has ever produced.

test('a stage is logged even when it refuses', async () => {
  const rec = recorder();
  await runStage(job({ intervene: async () => {} }), JOB_STAGE.INTERVENE, { log: rec.log });

  assert.equal(rec.rows.length, 1);
  assert.equal(rec.rows[0].outcome, STAGE_OUTCOME.REFUSED);
  assert.equal(rec.rows[0].job, 'test-job');
});

test('a stage is logged even when it throws', async () => {
  const rec = recorder();
  const result = await runStage(job({ detect: async () => { throw new Error('clone failed'); } }),
    JOB_STAGE.DETECT, { log: rec.log });

  assert.equal(result.outcome, STAGE_OUTCOME.FAILED);
  assert.equal(rec.rows.length, 1);
  assert.match(rec.rows[0].reason, /clone failed/);
});

test('the log is AWAITED before the stage result is returned, not fired and forgotten', async () => {
  const order = [];
  // The delay is the whole test. An earlier version used a synchronous log and
  // passed even when the write was changed to fire-and-forget, because the
  // microtask still landed before the assertion — a guard that could not fail.
  // A real store is slow, so the log must be genuinely awaited for the attempt
  // count to survive a crash between the stage and its record.
  const log = async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push('logged');
  };

  await runStage(job({ detect: async () => { order.push('ran'); } }), JOB_STAGE.DETECT, { log });
  order.push('returned');

  assert.deepEqual(order, ['ran', 'logged', 'returned']);
});

// Stage absence, and the whole loop.

test('a stage the job does not declare is refused rather than treated as success', async () => {
  const result = await runStage(job({ detect: async () => {} }), JOB_STAGE.CHARGE,
    { approval: 'x', context: { evidence: { externalRef: 'r', source: 'bank' } }, log: recorder().log });

  assert.equal(result.outcome, STAGE_OUTCOME.REFUSED);
  assert.match(result.reason, /does not declare/i);
});

test('runJob stops at the first refusal instead of carrying on', async () => {
  const rec = recorder();
  const ran = [];
  const result = await runJob(job({
    detect: async () => { ran.push('detect'); return ['finding']; },
    intervene: async () => { ran.push('intervene'); },
    verify: async () => { ran.push('verify'); },
    charge: async () => { ran.push('charge'); }
  }), { log: rec.log });   // no approval

  assert.deepEqual(ran, ['detect'], 'intervene must halt the run, not be skipped over');
  assert.equal(result.stopped, JOB_STAGE.INTERVENE);
  assert.equal(result.charged, false);
});

test('APPROVAL_REQUIRED names intervene, and only intervene', async () => {
  assert.deepEqual([...APPROVAL_REQUIRED], [JOB_STAGE.INTERVENE]);
});

// GATE 3 — ledger. The job describes the money; the RUNNER writes it, through
// money-ledger and nowhere else. A job that could write its own settlement row
// would make every other gate decorative.

test('the runner settles the charge, and the job never writes the ledger itself', async () => {
  const settled = [];
  const chargeJob = job({
    verify: async () => ({ externalRef: 'UPI-8842190', source: 'bank' }),
    charge: async () => ({ source: 'bank', externalRef: 'UPI-8842190', grossCents: 50000, currency: 'INR' })
  });

  const result = await runJob(chargeJob, {
    approval: 'operator:joyel', log: recorder().log,
    settle: async (s) => { settled.push(s); return { id: 'settlement-1', ...s }; }
  });

  assert.equal(result.charged, true);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].externalRef, 'UPI-8842190');
  assert.equal(settled[0].rail, 'test-rail', 'the rail comes from the descriptor, not the job body');
});

test('a charge stage that returns no settlement describes no money and is refused', async () => {
  const settled = [];
  const result = await runJob(job({
    verify: async () => ({ externalRef: 'UPI-1', source: 'bank' }),
    charge: async () => undefined
  }), { approval: 'operator:joyel', log: recorder().log, settle: async (s) => { settled.push(s); } });

  assert.equal(result.charged, false);
  assert.equal(settled.length, 0);
  const charge = result.runs.find(r => r.stage === 'charge');
  assert.equal(charge.outcome, STAGE_OUTCOME.FAILED);
  assert.match(charge.reason, /settlement/i);
});

test('a failing ledger write is not reported as a successful charge', async () => {
  const result = await runJob(job({
    verify: async () => ({ externalRef: 'UPI-2', source: 'bank' }),
    charge: async () => ({ source: 'self-reported', externalRef: 'UPI-2', grossCents: 100 })
  }), {
    approval: 'operator:joyel', log: recorder().log,
    settle: async () => { throw new Error('settlement source must be one of stripe, paypal, bank, manual_receipt'); }
  });

  assert.equal(result.charged, false);
  const charge = result.runs.find(r => r.stage === 'charge');
  assert.equal(charge.outcome, STAGE_OUTCOME.FAILED);
  assert.match(charge.reason, /self-reported revenue|source must be one of/i);
});

// The defaults matter as much as the injectable seams: a caller that forgets to
// pass a log must still produce an attempt row, or the count silently reverts to
// the state that made this whole module necessary.

test('a run with no injected log still writes to the real attempt store', async () => {
  const { listJobRuns, resetJobRunLogForTesting } = await import('../src/job-run-log.js');
  resetJobRunLogForTesting();

  await runStage(job({ detect: async () => ['x'] }), JOB_STAGE.DETECT);

  const runs = await listJobRuns({ job: 'test-job' });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].stage, 'detect');
  assert.equal(runs[0].outcome, 'OK');
});

test('a run with no injected settle cannot quietly invent a settlement', async () => {
  const { resetJobRunLogForTesting } = await import('../src/job-run-log.js');
  resetJobRunLogForTesting();

  // Default settle is the real recordSettlement, which refuses a bad source.
  const result = await runJob(job({
    verify: async () => ({ externalRef: 'UPI-3', source: 'bank' }),
    charge: async () => ({ source: 'vibes', externalRef: 'UPI-3', grossCents: 100 })
  }), { approval: 'operator:joyel' });

  assert.equal(result.charged, false);
  assert.match(result.runs.at(-1).reason, /source must be one of/);
});

// DAG execution integration through runJob / runDagJob

test('runJob automatically executes a DAG job in topological wave order', async () => {
  const dagJob = {
    key: 'dag-job',
    rail: 'dag-rail',
    dag: {
      detect: { stage: 'detect', run: async () => 'data' },
      enrichA: { dependsOn: ['detect'], run: async ({ results }) => `${results.detect}-A` },
      enrichB: { dependsOn: ['detect'], run: async ({ results }) => `${results.detect}-B` },
      verify: {
        stage: 'verify',
        dependsOn: ['enrichA', 'enrichB'],
        run: async ({ results }) => ({ externalRef: 'TX-999', source: 'bank', a: results.enrichA, b: results.enrichB })
      }
    }
  };

  const res = await runJob(dagJob, { log: recorder().log });
  assert.equal(res.ok, true);
  assert.equal(res.results.detect, 'data');
  assert.equal(res.results.enrichA, 'data-A');
  assert.equal(res.results.enrichB, 'data-B');
  assert.equal(res.results.verify.externalRef, 'TX-999');
  assert.equal(res.runs.length, 4);
});

test('DAG job refuses intervene node without operator approval', async () => {
  const dagJob = {
    key: 'dag-gate1',
    dag: {
      detect: { stage: 'detect', run: async () => 'data' },
      intervene: { stage: 'intervene', dependsOn: ['detect'], run: async () => 'sent' }
    }
  };

  const res = await runJob(dagJob, { approval: null, log: recorder().log });
  assert.equal(res.ok, false);
  assert.equal(res.stopped, 'intervene');
  const interveneRun = res.runs.find(r => r.stage === 'intervene');
  assert.equal(interveneRun.outcome, STAGE_OUTCOME.REFUSED);
  assert.match(interveneRun.reason, /operator approval/i);
});

test('DAG job charges and settles when verify provides evidence and approval exists', async () => {
  let settled = false;
  const dagJob = {
    key: 'dag-charge',
    rail: 'bank-rail',
    dag: {
      verify: {
        stage: 'verify',
        run: async () => ({ externalRef: 'UPI-7771', source: 'bank' })
      },
      charge: {
        stage: 'charge',
        dependsOn: ['verify'],
        run: async () => ({ source: 'bank', externalRef: 'UPI-7771', grossCents: 25000, currency: 'INR' })
      }
    }
  };

  const res = await runJob(dagJob, {
    approval: 'operator:joyel',
    log: recorder().log,
    settle: async (s) => { settled = true; return { id: 'settle-99', ...s }; }
  });

  assert.equal(res.ok, true);
  assert.equal(res.charged, true);
  assert.equal(settled, true);
  assert.equal(res.results.charge.id, 'settle-99');
});

