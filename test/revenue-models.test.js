import test from 'node:test';
import assert from 'node:assert/strict';
import { exploreRevenueModels } from '../src/revenue-models.js';

test('does not revive the current money-flow leader or rejected IDs', () => {
  const out = exploreRevenueModels();
  const ids = [...out.survivors, ...out.contenders, ...out.blocked].map((m) => m.id);
  assert.equal(ids.includes('cloud-support-plan-right-sizing-engine'), false);
  assert.equal(ids.includes('card-authorization-integrity-fee-prevention-engine'), false);
  assert.equal(out.counts.explored, ids.length);
  assert.ok(out.capture.length >= 3);
});

test('splits below-threshold models from hard-gate failures', () => {
  const out = exploreRevenueModels();
  for (const m of out.contenders) {
    assert.equal(m.qualification.hardGateFailures.length, 0);
    assert.equal(m.qualification.passes, false);
    assert.equal(m.decision, 'BELOW_THRESHOLD');
  }
  for (const m of out.blocked) {
    assert.ok(m.qualification.hardGateFailures.length > 0);
    assert.equal(m.decision, 'BLOCKED');
  }
});
