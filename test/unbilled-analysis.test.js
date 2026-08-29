import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeUnbilledCapture } from '../src/unbilled-analysis.js';

test('unbilled capture is below freeze and names the freeze path', () => {
  const a = analyzeUnbilledCapture();
  assert.equal(a.id, 'contractor-unbilled-work-capture');
  assert.equal(a.score < a.threshold, true);
  assert.ok(a.gap > 0);
  assert.ok(a.freezePath.whatWorks.length >= 1);
  assert.ok(a.killIf.length >= 3);
  assert.ok(a.gates.some((g) => g.key === 'executionAutonomy' && g.hardGate));
});
