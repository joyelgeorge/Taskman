import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSourceWeight,
  recordSourceOutcome,
  listSourceWeights,
  resetSourceWeightMemory
} from '../marketing/source-weight-store.js';
import {
  insertSignals,
  countCorroboratingSignals,
  resetSignalMemory
} from '../signals/store.js';
import { registerDrone, resetDroneMemory } from '../drones/store.js';

// Test 1: Default weight for unknown source is 0.8 (alpha=8, beta=2)
test('unknown source returns default weight 0.8 (alpha=8, beta=2)', async () => {
  await resetSourceWeightMemory();
  const result = await getSourceWeight('unknown-source');
  assert.equal(result.sourceKey, 'unknown-source');
  assert.equal(result.alpha, 8);
  assert.equal(result.beta, 2);
  assert.ok(Math.abs(result.weight - 0.8) < 1e-9, `Expected weight 0.8, got ${result.weight}`);
});

// Test 2: After 1 win: alpha=9, beta=2, weight = 9/11 ≈ 0.818
test('after 1 win: alpha=9, beta=2, weight=9/11', async () => {
  await resetSourceWeightMemory();
  const result = await recordSourceOutcome('src-a', 'win');
  assert.equal(result.alpha, 9);
  assert.equal(result.beta, 2);
  const expected = 9 / 11;
  assert.ok(Math.abs(result.weight - expected) < 1e-9, `Expected weight ${expected}, got ${result.weight}`);
});

// Test 3: After 1 win + 1 loss: alpha=9, beta=3, weight = 9/12 = 0.75
test('after 1 win + 1 loss: alpha=9, beta=3, weight=0.75', async () => {
  await resetSourceWeightMemory();
  await recordSourceOutcome('src-b', 'win');
  const result = await recordSourceOutcome('src-b', 'loss');
  assert.equal(result.alpha, 9);
  assert.equal(result.beta, 3);
  assert.ok(Math.abs(result.weight - 0.75) < 1e-9, `Expected weight 0.75, got ${result.weight}`);
});

// Test 4: listSourceWeights returns all tracked sources
test('listSourceWeights returns all tracked sources', async () => {
  await resetSourceWeightMemory();
  await recordSourceOutcome('src-c', 'win');
  await recordSourceOutcome('src-d', 'loss');
  const list = await listSourceWeights();
  const keys = list.map(r => r.sourceKey);
  assert.ok(keys.includes('src-c'), `Expected src-c in ${JSON.stringify(keys)}`);
  assert.ok(keys.includes('src-d'), `Expected src-d in ${JSON.stringify(keys)}`);
  assert.equal(list.length, 2);
});

// Test 5: countCorroboratingSignals counts distinct droneIds
test('countCorroboratingSignals returns 3 for 3 drones with matching word', async () => {
  await resetSignalMemory();
  await resetDroneMemory();

  const droneIds = ['drone-1', 'drone-2', 'drone-3'];
  for (const droneId of droneIds) {
    await registerDrone({
      id: droneId,
      kind: 'rss',
      name: droneId,
      targetUrl: `https://${droneId}.example/feed`
    });
    await insertSignals(droneId, [{
      fingerprint: `fp-${droneId}`,
      kind: 'story',
      title: `automation drives efficiency`,
      payload: {},
      observedAt: new Date().toISOString()
    }]);
  }

  const count = await countCorroboratingSignals(['automation']);
  assert.equal(count, 3, `Expected 3 corroborating drones, got ${count}`);
});
