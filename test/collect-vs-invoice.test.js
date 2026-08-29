import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCollectVsInvoice } from '../src/collect-vs-invoice.js';

test('UPI collect outscores invoice-only as the money event', () => {
  const c = compareCollectVsInvoice();
  const byId = Object.fromEntries(c.paths.map((p) => [p.id, p.qualification.score]));
  assert.ok(byId['upi-collect-only'] > byId['invoice-only']);
  assert.equal(c.winner, 'upi-collect-only');
  assert.ok(c.rules.length >= 4);
});
