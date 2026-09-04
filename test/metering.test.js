import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLABLE_METRICS,
  resetMeteringForTesting,
  configureMemoryAccountPlan,
  checkEntitlement,
  requireEntitlement,
  recordMeterEvent,
  recordMeterCorrection,
  accountUsageSummary,
  seedDevelopmentPlan,
  billingExportStatus,
  createBillingExportAdapter
} from '../src/metering.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalExportFlag = process.env.TASKMAN_BILLING_EXPORT_ENABLED;

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.TASKMAN_BILLING_EXPORT_ENABLED;
  resetMeteringForTesting();
  configureMemoryAccountPlan({
    accountId: 'acct-test',
    entitlements: [
      { metricId: 'ai_tokens', hardLimit: 100, softLimit: 80 },
      { metricId: 'successful_runs', hardLimit: 2, softLimit: 1 }
    ]
  });
});

afterEach(() => {
  if (originalNodeEnv == null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalExportFlag == null) delete process.env.TASKMAN_BILLING_EXPORT_ENABLED;
  else process.env.TASKMAN_BILLING_EXPORT_ENABLED = originalExportFlag;
});

test('unknown and exhausted entitlements fail closed before spend', async () => {
  assert.deepEqual(
    await checkEntitlement({ accountId: 'missing', metricId: 'ai_tokens', proposedQuantity: 1 }),
    { allowed: false, code: 'ENTITLEMENT_UNKNOWN' }
  );

  await recordMeterEvent({
    accountId: 'acct-test', metricId: 'ai_tokens', quantity: 90, unit: 'token',
    sourceId: 'run-1:tokens', occurredAt: '2026-08-30T10:00:00Z'
  });
  const decision = await checkEntitlement({ accountId: 'acct-test', metricId: 'ai_tokens', proposedQuantity: 11 });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'ENTITLEMENT_EXHAUSTED');
  assert.equal(decision.remaining, 10);
  await assert.rejects(
    requireEntitlement({ accountId: 'acct-test', metricId: 'ai_tokens', proposedQuantity: 11 }),
    error => error.code === 'ENTITLEMENT_EXHAUSTED'
  );
});

test('concurrent replay of one source creates one immutable meter event', async () => {
  const input = {
    accountId: 'acct-test', metricId: 'successful_runs', metricVersion: 1,
    quantity: 1, unit: 'run', sourceId: 'run-42:successful_run',
    occurredAt: '2026-08-30T10:00:00Z',
    provenance: { runId: 'run-42', provider: 'test', secret: 'must-not-survive', prompt: 'private' }
  };
  const results = await Promise.all(Array.from({ length: 20 }, () => recordMeterEvent(input)));
  assert.equal(results.filter(result => result.inserted).length, 1);
  assert.deepEqual(results[0].event.provenance, { runId: 'run-42', provider: 'test' });

  const summary = await accountUsageSummary({
    accountId: 'acct-test', from: '2026-08-30T00:00:00Z', to: '2026-08-31T00:00:00Z'
  });
  assert.equal(summary.events.length, 1);
  assert.equal(summary.totals['successful_runs:1'], 1);
});

test('corrections compensate without mutating original evidence', async () => {
  const original = await recordMeterEvent({
    accountId: 'acct-test', metricId: 'ai_tokens', quantity: 25, unit: 'token',
    sourceId: 'run-2:tokens', occurredAt: '2026-08-30T11:00:00Z'
  });
  const correction = await recordMeterCorrection({
    originalEventId: original.event.id,
    sourceId: 'correction:run-2:tokens',
    occurredAt: '2026-08-30T12:00:00Z',
    provenance: { reasonCode: 'PROVIDER_USAGE_REVERSED' }
  });
  assert.equal(correction.event.quantity, -25);
  assert.equal(correction.event.correctionOf, original.event.id);
  assert.equal(original.event.quantity, 25);

  const summary = await accountUsageSummary({
    accountId: 'acct-test', from: '2026-08-30T00:00:00Z', to: '2026-08-31T00:00:00Z'
  });
  assert.equal(summary.totals['ai_tokens:1'], 0);
});

test('account summaries require an explicit UTC window and paginate with opaque cursors', async () => {
  for (let index = 0; index < 3; index += 1) {
    await recordMeterEvent({
      accountId: 'acct-test', ...{
        metricId: BILLABLE_METRICS.SUCCESSFUL_RUNS.id,
        metricVersion: BILLABLE_METRICS.SUCCESSFUL_RUNS.version,
        unit: BILLABLE_METRICS.SUCCESSFUL_RUNS.unit
      },
      quantity: 1, sourceId: `run-${index}:successful_run`,
      occurredAt: `2026-08-30T10:0${index}:00Z`
    });
  }
  const first = await accountUsageSummary({
    accountId: 'acct-test', from: '2026-08-30T00:00:00Z', to: '2026-08-31T00:00:00Z', limit: 2
  });
  assert.equal(first.events.length, 2);
  assert.equal(first.totals['successful_runs:1'], 3);
  assert.ok(first.nextCursor);
  assert.deepEqual(first.window, {
    from: '2026-08-30T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z', timezone: 'UTC'
  });
  const second = await accountUsageSummary({
    accountId: 'acct-test', from: '2026-08-30T00:00:00Z', to: '2026-08-31T00:00:00Z',
    limit: 2, cursor: first.nextCursor
  });
  assert.equal(second.events.length, 1);
  assert.equal(second.totals['successful_runs:1'], 3);
  assert.equal(second.nextCursor, null);
  await assert.rejects(
    accountUsageSummary({ accountId: 'acct-test', from: 'invalid', to: '2026-08-31T00:00:00Z' }),
    /from must be a valid timestamp/
  );
});

test('development plan and live billing export both remain fail closed in production', async () => {
  resetMeteringForTesting();
  seedDevelopmentPlan();
  process.env.NODE_ENV = 'production';
  const decision = await checkEntitlement({ accountId: 'local-default', metricId: 'ai_tokens', proposedQuantity: 1 });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'DEVELOPMENT_PLAN_FORBIDDEN');
  assert.deepEqual(billingExportStatus(), { enabled: false, mode: 'adapter-only', performsCharges: false });
});

test('billing export adapter is disabled by default and idempotent when explicitly enabled', async () => {
  const meter = await recordMeterEvent({
    accountId: 'acct-test', metricId: 'successful_runs', quantity: 1, unit: 'run',
    sourceId: 'run-export:successful', occurredAt: '2026-08-30T13:00:00Z'
  });
  let calls = 0;
  const adapter = createBillingExportAdapter({
    provider: 'fake-billing',
    send: async payload => {
      calls += 1;
      assert.equal(payload.accountId, 'acct-test');
      assert.equal(payload.idempotencyKey, 'export-once');
      assert.equal('prompt' in payload, false);
      return { reference: 'fake-ref-1' };
    }
  });
  assert.equal(adapter.performsCharges, false);
  const disabled = await adapter.exportMeterEvent(meter.event, { idempotencyKey: 'export-once' });
  assert.equal(disabled.status, 'disabled');
  assert.equal(calls, 0);

  process.env.TASKMAN_BILLING_EXPORT_ENABLED = 'true';
  const first = await adapter.exportMeterEvent(meter.event, { idempotencyKey: 'export-once' });
  const replay = await adapter.exportMeterEvent(meter.event, { idempotencyKey: 'export-once' });
  assert.equal(first.status, 'exported');
  assert.equal(replay.status, 'exported');
  assert.equal(replay.replay, true);
  assert.equal(calls, 1);
});
