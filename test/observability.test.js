import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTraceEvent,
  configureTelemetryExporter,
  evaluateOperationalAlerts,
  getObservabilitySnapshot,
  getPipelineObservabilitySummary,
  recordMetric,
  recordScheduleRun,
  resetObservabilityForTesting,
  sanitizeMetricLabels,
  sanitizeTraceAttributes,
  withTelemetrySpan
} from '../src/observability.js';
import { runWithFallback } from '../src/providers.js';
import { runDiscoverWorker } from '../src/workers/discover.js';
import { upsertRevenueRecord } from '../src/revenue-store.js';
import { CANONICAL_QUEUES } from '../src/orchestration-profiles.js';

test.beforeEach(() => resetObservabilityForTesting());

test('telemetry allowlists attributes and removes sensitive fields and values', () => {
  const attributes = sanitizeTraceAttributes({
    correlation_id: 'corr-1', stage: 'DISCOVER', provider: 'mock',
    prompt: 'private prompt', authorization: 'Bearer secret', api_key: 'secret',
    error_code: 'sk-abcdefghijklmnopqrstuvwxyz'
  });
  assert.deepEqual(attributes, { correlation_id: 'corr-1', stage: 'DISCOVER', provider: 'mock' });
  const labels = sanitizeMetricLabels({
    stage: 'EXECUTE', candidate_id: 'high-cardinality', queue: 'execution', payload: 'private'
  });
  assert.deepEqual(labels, { stage: 'EXECUTE', queue: 'execution' });
});

test('nested spans preserve trace continuity and keep identifiers out of metric labels', async () => {
  await withTelemetrySpan('scheduler.run', {
    correlation_id: 'run-key-1', run_key: 'run-key-1', stage: 'DISCOVER'
  }, async () => {
    await withTelemetrySpan('pipeline.discover', { stage: 'DISCOVER', candidate_id: 'candidate-1' }, async () => {
      addTraceEvent('queue.enqueue', { queue: 'candidates', queue_item_id: 'item-1', outcome: 'enqueued' });
      recordMetric('pipeline_stage_runs_total', 1, { stage: 'DISCOVER', candidate_id: 'candidate-1' });
    });
  });
  const snapshot = getObservabilitySnapshot();
  const root = snapshot.traces.find(span => span.name === 'scheduler.run');
  const child = snapshot.traces.find(span => span.name === 'pipeline.discover');
  assert.equal(child.traceId, root.traceId);
  assert.equal(child.parentSpanId, root.spanId);
  assert.equal(child.correlationId, 'run-key-1');
  assert.equal(child.events[0].attributes.queue_item_id, 'item-1');
  assert.equal(snapshot.metrics[0].labels.candidate_id, undefined);
});

test('exporter failure is isolated from domain work and counted', async () => {
  configureTelemetryExporter(async () => { throw new Error('collector unavailable'); });
  const result = await withTelemetrySpan('pipeline.validate', { stage: 'VALIDATE' }, async () => 'domain-result');
  assert.equal(result, 'domain-result');
  await new Promise(resolve => setImmediate(resolve));
  const failures = getObservabilitySnapshot().metrics.find(metric => metric.name === 'telemetry_export_failures_total');
  assert.equal(failures.sum, 1);
});

test('provider fallback records latency and error without prompt or credential leakage', async () => {
  const providers = [
    { id: 'first', model: 'model-a', env: 'FIRST_KEY', call: async () => { throw new Error('failed'); } },
    { id: 'second', model: 'model-b', env: 'SECOND_KEY', call: async () => ({ text: 'ok', inputTokens: 1, outputTokens: 1 }) }
  ];
  const result = await withTelemetrySpan('task.run', { correlation_id: 'provider-run' }, () => runWithFallback('private input', {
    providerList: providers,
    env: { FIRST_KEY: 'sk-first-secret-value', SECOND_KEY: 'sk-second-secret-value' },
    providerTimeoutMs: 100,
    runTimeoutMs: 500
  }));
  assert.equal(result.provider, 'second');
  assert.equal(result.fallbacks.length, 1);
  const serialized = JSON.stringify(getObservabilitySnapshot());
  assert.doesNotMatch(serialized, /private input|first-secret|second-secret/);
  const providerMetrics = getObservabilitySnapshot().metrics.filter(metric => metric.name === 'provider_requests_total');
  assert.equal(providerMetrics.length, 2);
  assert.ok(providerMetrics.some(metric => metric.labels.outcome === 'error'));
  assert.ok(providerMetrics.some(metric => metric.labels.fallback === 'true'));
});

test('worker trace links a real queue transition to its correlation ID', async () => {
  const noveltyKey = `observable-${crypto.randomUUID()}`;
  const result = await withTelemetrySpan('scheduler.run', {
    correlation_id: noveltyKey, run_key: noveltyKey, schedule_id: 'discover', stage: 'DISCOVER'
  }, () => runDiscoverWorker({
    correlationId: noveltyKey,
    runKey: noveltyKey,
    scheduleId: 'discover',
    sources: [],
    sampleCandidates: [{
      candidateId: noveltyKey,
      noveltyKey,
      title: 'Observable candidate',
      profile: 'programmable_money_flow_v1',
      metrics: {
        flowScale: 1, recurrence: 1, triggerIndependence: 1, permission: 1,
        deltaMeasurability: 1, monetization: 1, executionAutonomy: 1,
        competitiveWhitespace: 1, setupBurden: 0, timeToMoney: 1
      },
      evidence: ['https://example.com/evidence']
    }],
    capabilityOptions: { env: {}, providers: [], rails: [] }
  }));
  assert.equal(result.enqueued, 1);
  const snapshot = getObservabilitySnapshot();
  const pipeline = snapshot.traces.find(span => span.name === 'pipeline.discover');
  assert.equal(pipeline.correlationId, noveltyKey);
  assert.ok(pipeline.events.some(event => event.name === 'queue.enqueue'));
});

test('queue summary detects active aging but never treats terminal outcomes as stalled', async () => {
  const baseline = await getPipelineObservabilitySummary({ maxStallMinutes: 60 });
  const oldDate = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.candidates,
    noveltyKey: `stalled-${crypto.randomUUID()}`,
    status: 'NEW',
    createdAt: oldDate,
    payload: { title: 'old active item' }
  });
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.outcomes,
    noveltyKey: `terminal-${crypto.randomUUID()}`,
    status: 'BLOCKED',
    createdAt: oldDate,
    payload: { estimatedValue: 999999 }
  });
  const summary = await getPipelineObservabilitySummary({ maxStallMinutes: 60 });
  assert.equal(summary.status, 'STALLED');
  assert.ok(summary.activeStalls.some(stall => stall.queue === 'candidates'));
  assert.ok(!summary.activeStalls.some(stall => stall.queue === 'outcomes'));
  assert.equal(summary.terminalOutcomes.BLOCKED >= 1, true);
  assert.equal(summary.verifiedRevenueEvents, baseline.verifiedRevenueEvents);
});

test('only verified positive MONEY_EVENT outcomes count as verified revenue events', async () => {
  const baseline = await getPipelineObservabilitySummary();
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.outcomes,
    noveltyKey: `estimate-${crypto.randomUUID()}`,
    status: 'MONEY_EVENT',
    payload: { estimatedValue: 5000, attributableValue: 0 }
  });
  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.outcomes,
    noveltyKey: `verified-${crypto.randomUUID()}`,
    status: 'MONEY_EVENT',
    payload: { attributableValue: 10, verificationRef: 'receipt:test' }
  });
  const summary = await getPipelineObservabilitySummary();
  assert.equal(summary.verifiedRevenueEvents, baseline.verifiedRevenueEvents + 1);
});

test('schedule metrics expose lag, duration, outcome, and reclaimed lease state', () => {
  recordScheduleRun({
    runKey: 'schedule:1', scheduleId: 'discover', stage: 'discover',
    scheduledFor: new Date(Date.now() - 2_000).toISOString(),
    outcome: 'COMPLETED', durationMs: 25, reclaimed: true
  });
  const metrics = getObservabilitySnapshot().metrics;
  assert.ok(metrics.some(metric => metric.name === 'scheduler_start_lag_ms' && metric.last >= 1_900));
  assert.ok(metrics.some(metric => metric.name === 'scheduler_run_duration_ms' && metric.last === 25));
  assert.ok(metrics.some(metric => metric.name === 'scheduler_lease_reclaims_total'));
});

test('provider error-rate alert is deterministic and includes a local runbook', () => {
  recordMetric('provider_requests_total', 1, { provider: 'a', outcome: 'error' });
  recordMetric('provider_requests_total', 1, { provider: 'b', outcome: 'success' });
  const alerts = evaluateOperationalAlerts({ providerErrorThreshold: 0.5 });
  const alert = alerts.find(item => item.code === 'PROVIDER_ERROR_RATE');
  assert.ok(alert);
  assert.match(alert.runbook, /OBSERVABILITY\.md/);
});
