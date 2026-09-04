import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startActivationSession,
  generateInstantAuditPreview,
  getActivationMetrics,
  _resetActivationState
} from '../src/instant-activation.js';

test.beforeEach(() => {
  _resetActivationState();
});

test('generateInstantAuditPreview delivers value in milliseconds with bundled sample', () => {
  const session = startActivationSession('test_session_1');
  const preview = generateInstantAuditPreview({ sessionId: session.sessionId });

  assert.equal(preview.sessionId, 'test_session_1');
  assert.equal(preview.isSamplePreview, true);
  assert.equal(preview.statementSummary.orderCount, 4);
  assert.equal(preview.statementSummary.grossEarnings, '$2500.00');
  assert.equal(preview.statementSummary.itemizedPlatformFees, '$500.00');
  assert.ok(typeof preview.timeToFirstValueMs === 'number');
  assert.ok(preview.economicNotice.includes('READ_ONLY_AUDIT_PREVIEW'));
  assert.equal(preview.minimumNextPermission.step, 'CONNECT_BANK_DEPOSIT_CSV');
});

test('generateInstantAuditPreview parses custom customer CSV and measures activation speed', () => {
  const customCsv = `Date,Order ID,Type,Gross Amount,Platform Fee,Currency
2026-09-01,FO999,Completed Order,100.00,20.00,USD`;

  const session = startActivationSession('test_session_2');
  const preview = generateInstantAuditPreview({ sessionId: session.sessionId, customCsv });

  assert.equal(preview.isSamplePreview, false);
  assert.equal(preview.statementSummary.grossEarnings, '$100.00');
  assert.equal(preview.statementSummary.itemizedPlatformFees, '$20.00');

  const metrics = getActivationMetrics();
  assert.equal(metrics.totalSessions, 1);
  assert.equal(metrics.completedSessions, 1);
  assert.ok(metrics.avgTimeToFirstValueMs >= 0);
});
