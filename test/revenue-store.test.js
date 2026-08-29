import test from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertRevenueRecord, listRevenueRecords, claimRevenueRecords,
  updateRevenueRecord, setRevenueState, getRevenueState, revenueStorageMode
} from '../src/revenue-store.js';

test('revenue queue deduplicates, prioritizes and claims work in memory mode', async () => {
  assert.equal(revenueStorageMode(), 'memory');
  const queue = `test-${crypto.randomUUID()}`;
  await upsertRevenueRecord({ queue, noveltyKey: 'a', priority: 1, payload: { n: 1 } });
  await upsertRevenueRecord({ queue, noveltyKey: 'b', priority: 10, payload: { n: 2 } });
  await upsertRevenueRecord({ queue, noveltyKey: 'a', priority: 5, payload: { n: 3 } });

  const rows = await listRevenueRecords(queue);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].noveltyKey, 'b');
  assert.equal(rows.find(r => r.noveltyKey === 'a').payload.n, 3);

  const claimed = await claimRevenueRecords(queue, { limit: 1, claimedBy: 'test-worker' });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].noveltyKey, 'b');
  assert.equal(claimed[0].status, 'CLAIMED');

  const updated = await updateRevenueRecord(claimed[0].id, { status: 'COMPLETED', payload: { result: 'ok' }, releaseClaim: true });
  assert.equal(updated.status, 'COMPLETED');
  assert.equal(updated.payload.result, 'ok');
});

test('revenue scan state round-trips in memory mode', async () => {
  const key = `scan-${crypto.randomUUID()}`;
  await setRevenueState(key, { useful: ['payment-lifecycle'] });
  assert.deepEqual(await getRevenueState(key), { useful: ['payment-lifecycle'] });
});
