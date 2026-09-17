import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDag, topoSort, runDag } from '../packages/core/jobs/dag.js';

/**
 * The Rails: typed DAG execution. Nodes declare dependencies; the scheduler
 * validates acyclicity and runs independent branches in parallel.
 *
 * Added beyond the spec: IDEMPOTENCY. A linear pipeline that reruns is merely
 * wasteful; a DAG node that charges money and reruns is a double charge. Every
 * node may declare an idempotencyKey, and a node whose key has already completed
 * is skipped rather than re-executed.
 */

const nodes = {
  detect:    { run: async () => 'found' },
  enrich:    { dependsOn: ['detect'], run: async () => 'enriched' },
  verify:    { dependsOn: ['detect'], run: async () => 'verified' },
  charge:    { dependsOn: ['enrich', 'verify'], run: async () => 'charged' }
};

test('a valid DAG passes validation', () => {
  assert.equal(validateDag(nodes).ok, true);
});

test('a cycle is rejected at validation, before anything runs', () => {
  const cyclic = { a: { dependsOn: ['b'], run: async () => 1 }, b: { dependsOn: ['a'], run: async () => 2 } };
  const res = validateDag(cyclic);
  assert.equal(res.ok, false);
  assert.match(res.error, /cycle/i);
});

test('a dependency on an undeclared node is rejected', () => {
  const bad = { a: { dependsOn: ['ghost'], run: async () => 1 } };
  const res = validateDag(bad);
  assert.equal(res.ok, false);
  assert.match(res.error, /ghost/);
});

test('topological order respects dependencies', () => {
  const order = topoSort(nodes).flat();
  assert.ok(order.indexOf('detect') < order.indexOf('enrich'));
  assert.ok(order.indexOf('verify') < order.indexOf('charge'));
});

test('independent nodes are grouped into the same parallel wave', () => {
  const waves = topoSort(nodes);
  const wave = waves.find(w => w.includes('enrich'));
  assert.ok(wave.includes('verify'), 'enrich and verify have no dependency between them');
});

test('runDag executes in dependency order and passes results downstream', async () => {
  const seen = {};
  const res = await runDag({
    detect: { run: async () => 'D' },
    charge: { dependsOn: ['detect'], run: async ({ results }) => { seen.fromDetect = results.detect; return 'C'; } }
  });
  assert.equal(res.ok, true);
  assert.equal(seen.fromDetect, 'D');
});

test('a failing node halts its dependents but reports what did run', async () => {
  const res = await runDag({
    detect: { run: async () => { throw new Error('boom'); } },
    charge: { dependsOn: ['detect'], run: async () => 'C' }
  });
  assert.equal(res.ok, false);
  assert.equal(res.failed, 'detect');
  assert.ok(!('charge' in res.results), 'a dependent of a failed node must not run');
});

test('a node whose idempotency key already completed is SKIPPED, not re-run', async () => {
  let charges = 0;
  const completed = new Set(['charge:order-123']);
  const res = await runDag({
    charge: { idempotencyKey: 'charge:order-123', run: async () => { charges++; return 'charged'; } }
  }, { completed });
  assert.equal(charges, 0, 'a money-moving node must never run twice for the same key');
  assert.equal(res.skipped.includes('charge'), true);
});

test('a node with an unseen idempotency key runs and records its key', async () => {
  const completed = new Set();
  await runDag({ charge: { idempotencyKey: 'charge:order-999', run: async () => 'charged' } }, { completed });
  assert.ok(completed.has('charge:order-999'), 'completing a node records its key so a rerun is a no-op');
});
