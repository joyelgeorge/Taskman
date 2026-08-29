import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAgentIdentity,
  listOpenJobs,
  evaluateJobExecutionGate
} from '../src/moltjobs-client.js';

test('MoltJobs client: getAgentIdentity fails closed when API key is missing', async () => {
  await assert.rejects(
    () => getAgentIdentity({ apiKey: null }),
    /MOLTJOBS_API_KEY is required/
  );
});

test('MoltJobs client: getAgentIdentity returns non-secret identity fields', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: 'agent-123',
      name: 'Taskman-Worker',
      status: 'ACTIVE',
      verified: true,
      reputation: 98,
      secret_token: 'should-never-be-returned'
    })
  });

  const identity = await getAgentIdentity({
    apiKey: 'test-key',
    fetchImpl: fakeFetch
  });

  assert.equal(identity.id, 'agent-123');
  assert.equal(identity.name, 'Taskman-Worker');
  assert.equal(identity.status, 'ACTIVE');
  assert.equal(identity.verified, true);
  assert.equal(identity.reputation, 98);
  assert.equal(identity.secret_token, undefined, 'Secret tokens must never be exposed');
});

test('MoltJobs client: listOpenJobs returns jobs array safely', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => [
      { id: 'job-1', title: 'Data Cleaning Task', reward: 50, escrow_funded: true, status: 'open' }
    ]
  });

  const jobs = await listOpenJobs({ apiKey: 'test-key', fetchImpl: fakeFetch });
  assert.equal(Array.isArray(jobs), true);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, 'job-1');
});

test('MoltJobs client: evaluateJobExecutionGate classifies fully verified job as EXECUTABLE', () => {
  const job = {
    id: 'job-pass',
    title: 'Well-defined Task',
    status: 'open',
    escrow_funded: true,
    payout_method: 'direct_escrow',
    acceptance_criteria: 'Submit validated JSON payload',
    worker_cost: 0,
    requires_wallet_signature: false,
    requires_call: false
  };

  const gate = evaluateJobExecutionGate(job);
  assert.equal(gate.passed, true);
  assert.equal(gate.classification, 'EXECUTABLE');
  assert.equal(gate.gates.payerVerified, true);
  assert.equal(gate.gates.zeroUpfrontSpend, true);
});

test('MoltJobs client: evaluateJobExecutionGate rejects job requiring upfront spend or gas', () => {
  const badJob = {
    id: 'job-fail',
    title: 'Suspicious Task',
    status: 'open',
    escrow_funded: true,
    payout_method: 'direct_escrow',
    acceptance_criteria: 'Deposit initial fee',
    worker_cost: 10,
    requires_wallet_signature: true
  };

  const gate = evaluateJobExecutionGate(badJob);
  assert.equal(gate.passed, false);
  assert.equal(gate.classification, 'REJECTED');
  assert.equal(gate.gates.zeroUpfrontSpend, false);
  assert.equal(gate.gates.noUnsupportedSigning, false);
});
