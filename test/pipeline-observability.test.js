import test from 'node:test';
import assert from 'node:assert/strict';
import { getPipelineObservabilitySummary, PIPELINE_HEALTH_STATUS } from '../src/pipeline-observability.js';
import { upsertRevenueRecord } from '../src/revenue-store.js';
import { CANONICAL_QUEUES } from '../src/orchestration-profiles.js';

test('Pipeline Observability: returns queue depth and healthy status', async () => {
  const summary = await getPipelineObservabilitySummary();
  assert.ok(summary.queueDepth);
  assert.equal(typeof summary.queueDepth.candidates, 'number');
  assert.equal(typeof summary.queueDepth.validation, 'number');
  assert.equal(typeof summary.queueDepth.execution, 'number');
  assert.ok(summary.status === PIPELINE_HEALTH_STATUS.HEALTHY || summary.status === PIPELINE_HEALTH_STATUS.STALLED);
});

test('Pipeline Observability: flags items stalled beyond threshold', async () => {
  const oldDate = new Date(Date.now() - 180 * 60_000).toISOString(); // 3 hours ago
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.candidates,
    noveltyKey: `stalled-test-${crypto.randomUUID()}`,
    status: 'NEW',
    payload: { title: 'Old item', stalledSince: oldDate }
  });

  const summary = await getPipelineObservabilitySummary({ maxStallMinutes: 60 });
  assert.equal(summary.status, PIPELINE_HEALTH_STATUS.STALLED);
  assert.ok(summary.activeStalls.length >= 1);
});
