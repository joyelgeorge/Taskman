import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePlanToDag, shadowExecute, describeEffects } from '../packages/core/bridge/compiler.js';

/**
 * The Bridge: compile an open-ended plan into a rigid DAG, or reject it with
 * diagnostics the generator can act on. Nothing stochastic reaches a rail
 * unvalidated.
 *
 * Added beyond the spec: shadow execution returns a HUMAN-READABLE EFFECT DIFF,
 * not a pass/fail. "It ran clean" invites rubber-stamping; "this will email 3
 * strangers and charge $5" is a decision someone can actually make.
 */

const registry = {
  scan:   { mutates: false },
  draft:  { mutates: false },
  send:   { mutates: true, highConsequence: true },
  charge: { mutates: true, highConsequence: true }
};

test('a plan using only registered tools compiles to a DAG', () => {
  const res = compilePlanToDag({ steps: [
    { id: 'a', tool: 'scan' }, { id: 'b', tool: 'draft', dependsOn: ['a'] }
  ] }, { registry });
  assert.equal(res.ok, true);
  assert.ok(res.dag.a && res.dag.b);
});

test('an unregistered tool is rejected with a diagnostic naming it', () => {
  const res = compilePlanToDag({ steps: [{ id: 'a', tool: 'rm_rf_everything' }] }, { registry });
  assert.equal(res.ok, false);
  assert.match(res.diagnostics[0], /rm_rf_everything/);
  assert.match(res.diagnostics[0], /not a registered capability/i);
});

test('a circular plan is rejected before execution, with the cycle named', () => {
  const res = compilePlanToDag({ steps: [
    { id: 'a', tool: 'scan', dependsOn: ['b'] }, { id: 'b', tool: 'draft', dependsOn: ['a'] }
  ] }, { registry });
  assert.equal(res.ok, false);
  assert.match(res.diagnostics.join(' '), /cycle/i);
});

test('a step depending on a nonexistent step is rejected', () => {
  const res = compilePlanToDag({ steps: [{ id: 'a', tool: 'scan', dependsOn: ['nope'] }] }, { registry });
  assert.equal(res.ok, false);
  assert.match(res.diagnostics.join(' '), /nope/);
});

test('shadow execution runs non-mutating steps and REFUSES mutating ones', async () => {
  const { dag } = compilePlanToDag({ steps: [
    { id: 'a', tool: 'scan' }, { id: 'b', tool: 'send', dependsOn: ['a'] }
  ] }, { registry });
  const shadow = await shadowExecute(dag, { registry, impls: { scan: async () => 'scanned', send: async () => { throw new Error('must not run'); } } });
  assert.equal(shadow.ran.includes('a'), true);
  assert.equal(shadow.withheld.includes('b'), true, 'a mutating step must never execute in shadow');
});

test('the effect summary names what WOULD happen, in plain language', () => {
  const { dag } = compilePlanToDag({ steps: [
    { id: 'a', tool: 'scan' }, { id: 'b', tool: 'send', dependsOn: ['a'] }, { id: 'c', tool: 'charge', dependsOn: ['b'] }
  ] }, { registry });
  const effects = describeEffects(dag, { registry });
  assert.equal(effects.highConsequence.length, 2);
  assert.ok(effects.summary.some(l => /send/i.test(l)));
  assert.ok(effects.requiresApproval, 'a plan containing high-consequence steps must demand approval');
});

test('a read-only plan needs no approval', () => {
  const { dag } = compilePlanToDag({ steps: [{ id: 'a', tool: 'scan' }] }, { registry });
  assert.equal(describeEffects(dag, { registry }).requiresApproval, false);
});
