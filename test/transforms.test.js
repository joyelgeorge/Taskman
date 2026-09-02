import test from 'node:test';
import assert from 'node:assert/strict';
import { runTransform } from '../src/transforms/base.js';
import { runAdversarialValidation, validateGateEvidencePostCondition } from '../src/transforms/adversarial-validation.js';
import { runExecutionPlan, planReferencesOnlyAvailableCapabilities } from '../src/transforms/execution-plan.js';
import { EIGHT_MONEY_FLOW_GATES } from '../src/gates.js';

const goodRef = gate => `https://aws.amazon.com/support/plans/#${gate}`;

// ---- base transform ---------------------------------------------------------

test('runTransform passes structurally-valid output straight through', async () => {
  const mock = async () => JSON.stringify({ candidates: [] });
  const result = await runTransform({ name: 't', prompt: 'x', schemaName: 'discovery_synthesis', mockProvider: mock });
  assert.equal(result.ok, true);
  assert.equal(result.transform, 't');
});

test('runTransform rejects on a failing post-condition even when the schema is satisfied', async () => {
  const mock = async () => JSON.stringify({ candidates: [] });
  const result = await runTransform({
    name: 't', prompt: 'x', schemaName: 'discovery_synthesis', mockProvider: mock,
    postCondition: () => ({ ok: false, reason: 'never trust this one' })
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /never trust this one/);
});

test('runTransform never reaches the post-condition when the schema itself fails', async () => {
  let called = false;
  const mock = async () => JSON.stringify({ notCandidates: [] });
  const result = await runTransform({
    name: 't', prompt: 'x', schemaName: 'discovery_synthesis', mockProvider: mock,
    postCondition: () => { called = true; return { ok: true }; }
  });
  assert.equal(result.ok, false);
  assert.equal(called, false, 'a post-condition should not run against data that never passed schema validation');
});

// ---- adversarial-validation transform ---------------------------------------

test('gate evidence that merely echoes the gate name is rejected', () => {
  const verdict = validateGateEvidencePostCondition({
    gateEvidence: { money_flow_scale: { verdict: 'pass', evidenceRef: 'money flow scale' } }
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /money_flow_scale/);
});

test('gate evidence that is a placeholder like "n/a" is rejected', () => {
  const verdict = validateGateEvidencePostCondition({
    gateEvidence: { monetization: { verdict: 'pass', evidenceRef: 'n/a' } }
  });
  assert.equal(verdict.ok, false);
});

test('an uncertain verdict does not require a citation', () => {
  const verdict = validateGateEvidencePostCondition({
    gateEvidence: { monetization: { verdict: 'uncertain', evidenceRef: '' } }
  });
  assert.equal(verdict.ok, true);
});

test('an unrecognized verdict word is rejected', () => {
  const verdict = validateGateEvidencePostCondition({
    gateEvidence: { monetization: { verdict: 'probably', evidenceRef: goodRef('monetization') } }
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /unrecognized verdict/);
});

test('real-looking citations for every gate pass the post-condition', () => {
  const gateEvidence = Object.fromEntries(
    EIGHT_MONEY_FLOW_GATES.map(g => [g, { verdict: 'pass', evidenceRef: goodRef(g) }])
  );
  assert.equal(validateGateEvidencePostCondition({ gateEvidence }).ok, true);
});

test('runAdversarialValidation discards a fabricated citation instead of forwarding it', async () => {
  const mock = async () => JSON.stringify({
    adversarialRisks: [],
    gateEvidence: { money_flow_scale: { verdict: 'pass', evidenceRef: 'money flow scale' } }
  });
  const result = await runAdversarialValidation({ candidate: { title: 'x' }, mockProvider: mock });
  assert.equal(result.ok, false);
  assert.match(result.error, /post-condition failed/);
});

test('runAdversarialValidation accepts real citations', async () => {
  const mock = async () => JSON.stringify({
    adversarialRisks: ['competitor lock-in'],
    gateEvidence: { money_flow_scale: { verdict: 'pass', evidenceRef: goodRef('money_flow_scale') } }
  });
  const result = await runAdversarialValidation({ candidate: { title: 'x' }, mockProvider: mock });
  assert.equal(result.ok, true);
  assert.equal(result.data.gateEvidence.money_flow_scale.evidenceRef, goodRef('money_flow_scale'));
});

// ---- execution-plan transform ------------------------------------------------

test('a plan step naming an unavailable capability is rejected', () => {
  const verdict = planReferencesOnlyAvailableCapabilities(
    { steps: [{ order: 1, action: 'move funds', capability: 'funds.move' }] },
    { 'web.read': true, 'funds.move': false }
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /funds\.move/);
});

test('a plan step naming an available capability passes', () => {
  const verdict = planReferencesOnlyAvailableCapabilities(
    { steps: [{ order: 1, action: 'read a page', capability: 'web.read' }] },
    { 'web.read': true }
  );
  assert.equal(verdict.ok, true);
});

test('the capability check also accepts a plain array of available names', () => {
  const verdict = planReferencesOnlyAvailableCapabilities(
    { steps: [{ order: 1, action: 'read', capability: 'web.read' }] },
    ['web.read']
  );
  assert.equal(verdict.ok, true);
});

test('runExecutionPlan refuses a plan that invents a capability the registry never granted', async () => {
  const mock = async () => JSON.stringify({
    actionSummary: 'Move platform funds automatically',
    requiredAdapters: ['wallet_adapter'],
    steps: [{ order: 1, action: 'transfer', capability: 'funds.move' }]
  });
  const result = await runExecutionPlan({
    candidate: { title: 'x' },
    availableCapabilities: { 'web.read': true, 'funds.move': false },
    mockProvider: mock
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /funds\.move/);
});

test('runExecutionPlan passes through a plan that only uses granted capabilities', async () => {
  const mock = async () => JSON.stringify({
    actionSummary: 'Read the pricing page',
    requiredAdapters: [],
    steps: [{ order: 1, action: 'fetch', capability: 'web.read' }]
  });
  const result = await runExecutionPlan({
    candidate: { title: 'x' },
    availableCapabilities: { 'web.read': true },
    mockProvider: mock
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.actionSummary, 'Read the pricing page');
});
