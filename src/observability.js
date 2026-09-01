import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { CANONICAL_QUEUES } from './orchestration-profiles.js';

const contextStore = new AsyncLocalStorage();
const spans = [];
const metrics = new Map();
const MAX_SPANS = 500;
const MAX_ATTRIBUTE_LENGTH = 160;

export const TRACE_ATTRIBUTE_KEYS = new Set([
  'correlation_id', 'run_key', 'task_id', 'schedule_id', 'candidate_id',
  'queue_item_id', 'stage', 'provider', 'model', 'attempt', 'outcome',
  'error_code', 'fallback', 'reclaimed', 'replay', 'conflict', 'queue',
  'route', 'method', 'status_code', 'storage_mode'
]);

export const METRIC_LABEL_KEYS = new Set([
  'stage', 'provider', 'model', 'outcome', 'error_code', 'fallback',
  'queue', 'route', 'method', 'status_class', 'storage_mode'
]);

const SENSITIVE_KEY = /(authorization|credential|secret|token|api[_-]?key|prompt|payload|body|cookie|email|phone)/i;
const SENSITIVE_VALUE = /(bearer\s+[a-z0-9._-]+|(?:sk|ghp|github_pat|aiza)[-_a-z0-9]{10,})/i;
let exporter = null;

function safeScalar(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  if (SENSITIVE_VALUE.test(value)) return undefined;
  return value.slice(0, MAX_ATTRIBUTE_LENGTH);
}

export function sanitizeTraceAttributes(attributes = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(attributes || {})) {
    if (!TRACE_ATTRIBUTE_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
    const scalar = safeScalar(value);
    if (scalar !== undefined) safe[key] = scalar;
  }
  return safe;
}

export function sanitizeMetricLabels(labels = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(labels || {})) {
    if (!METRIC_LABEL_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
    const scalar = safeScalar(value);
    if (scalar !== undefined) safe[key] = scalar;
  }
  return safe;
}

function metricKey(name, labels) {
  return `${name}|${JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)))}`;
}

export function recordMetric(name, value = 1, labels = {}, { kind = 'counter' } = {}) {
  const safeLabels = sanitizeMetricLabels(labels);
  const key = metricKey(String(name), safeLabels);
  const numeric = Number(value);
  const sample = Number.isFinite(numeric) ? numeric : 0;
  const current = metrics.get(key) || {
    name: String(name), kind, labels: safeLabels, count: 0, sum: 0,
    min: null, max: null, last: null, updatedAt: null
  };
  current.kind = kind;
  current.count += 1;
  current.sum += sample;
  current.min = current.min === null ? sample : Math.min(current.min, sample);
  current.max = current.max === null ? sample : Math.max(current.max, sample);
  current.last = sample;
  current.updatedAt = new Date().toISOString();
  metrics.set(key, current);
  return { ...current };
}

function appendSpan(span) {
  spans.push(span);
  if (spans.length > MAX_SPANS) spans.splice(0, spans.length - MAX_SPANS);
  if (!exporter) return;
  Promise.resolve(exporter({ ...span })).catch(() => {
    recordMetric('telemetry_export_failures_total', 1, { outcome: 'failed' });
  });
}

export function configureTelemetryExporter(nextExporter = null) {
  if (nextExporter !== null && typeof nextExporter !== 'function') {
    throw new Error('telemetry exporter must be a function or null');
  }
  exporter = nextExporter;
}

export function currentTraceContext() {
  const context = contextStore.getStore();
  return context ? { traceId: context.traceId, spanId: context.spanId, correlationId: context.correlationId } : null;
}

export function addTraceEvent(name, attributes = {}) {
  const context = contextStore.getStore();
  if (!context?.span) return false;
  context.span.events.push({
    name: String(name).slice(0, 80),
    at: new Date().toISOString(),
    attributes: sanitizeTraceAttributes(attributes)
  });
  return true;
}

export async function withTelemetrySpan(name, attributes, operation) {
  const parent = contextStore.getStore();
  const safeAttributes = sanitizeTraceAttributes(attributes);
  const traceId = parent?.traceId || crypto.randomUUID();
  const spanId = crypto.randomUUID();
  const startedAt = new Date();
  const correlationId = safeAttributes.correlation_id || parent?.correlationId || traceId;
  const span = {
    traceId, spanId, parentSpanId: parent?.spanId || null, correlationId,
    name: String(name).slice(0, 100), attributes: safeAttributes, events: [],
    status: 'RUNNING', startedAt: startedAt.toISOString(), finishedAt: null,
    durationMs: null
  };
  const context = { traceId, spanId, correlationId, span };

  return contextStore.run(context, async () => {
    try {
      const result = await operation(span);
      span.status = 'OK';
      return result;
    } catch (error) {
      span.status = 'ERROR';
      span.attributes = {
        ...span.attributes,
        error_code: String(error?.code || 'UNEXPECTED_ERROR').slice(0, MAX_ATTRIBUTE_LENGTH)
      };
      throw error;
    } finally {
      const finishedAt = new Date();
      span.finishedAt = finishedAt.toISOString();
      span.durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
      appendSpan(span);
    }
  });
}

export function recordStageResult(stage, result = {}) {
  const normalizedStage = String(stage || 'unknown').toUpperCase();
  const outcome = String(result.status || result.outcomeStatus || 'UNKNOWN').toUpperCase();
  recordMetric('pipeline_stage_runs_total', 1, { stage: normalizedStage, outcome });
  recordMetric('pipeline_stage_duration_ms', Number(result.durationMs || 0), { stage: normalizedStage, outcome }, { kind: 'histogram' });
  addTraceEvent('pipeline.stage.result', { stage: normalizedStage, outcome });
}

export function recordProviderAttempt({ provider, model, durationMs, outcome, errorCode, fallback = false }) {
  const labels = {
    provider: provider || 'unknown', model: model || 'unknown',
    outcome: outcome || 'unknown', error_code: errorCode || undefined,
    fallback: fallback ? 'true' : 'false'
  };
  recordMetric('provider_requests_total', 1, labels);
  recordMetric('provider_latency_ms', durationMs, labels, { kind: 'histogram' });
  addTraceEvent('provider.attempt', { provider, model, outcome, error_code: errorCode, fallback });
}

export function recordScheduleRun({ runKey, scheduleId, stage, scheduledFor, outcome, durationMs = 0, reclaimed = false }) {
  const lagMs = scheduledFor ? Math.max(0, Date.now() - new Date(scheduledFor).getTime()) : 0;
  const labels = { stage, outcome };
  recordMetric('scheduler_runs_total', 1, labels);
  recordMetric('scheduler_start_lag_ms', lagMs, labels, { kind: 'histogram' });
  recordMetric('scheduler_run_duration_ms', durationMs, labels, { kind: 'histogram' });
  if (reclaimed) recordMetric('scheduler_lease_reclaims_total', 1, { stage, outcome: 'reclaimed' });
  addTraceEvent('scheduler.result', { run_key: runKey, schedule_id: scheduleId, stage, outcome, reclaimed });
}

export async function getPipelineObservabilitySummary({ now = new Date(), maxStallMinutes = 60 } = {}) {
  const { listRevenueRecords, revenueStorageMode } = await import('./revenue-store.js');
  const queues = [
    ['candidates', CANONICAL_QUEUES.candidates],
    ['validation', CANONICAL_QUEUES.validation],
    ['execution', CANONICAL_QUEUES.execution],
    ['outcomes', CANONICAL_QUEUES.outcomes]
  ];
  const queueDepth = {};
  const oldestAgeMinutes = {};
  const activeStalls = [];
  const terminalOutcomes = {};
  let verifiedRevenueEvents = 0;
  const activeStatuses = new Set(['NEW', 'PENDING', 'PROMISING', 'NEEDS_EVIDENCE', 'CLAIMED', 'SETUP_REQUIRED']);
  for (const [label, queue] of queues) {
    const records = await listRevenueRecords(queue, { limit: 500 });
    const activeRecords = label === 'outcomes'
      ? []
      : records.filter(record => activeStatuses.has(String(record.status || '').toUpperCase()));
    queueDepth[label] = activeRecords.length;
    const oldest = activeRecords.reduce((min, record) => {
      const value = new Date(record.createdAt).getTime();
      return Number.isFinite(value) ? Math.min(min, value) : min;
    }, Infinity);
    const age = oldest === Infinity ? 0 : Math.max(0, (now.getTime() - oldest) / 60_000);
    oldestAgeMinutes[label] = Math.round(age * 100) / 100;
    recordMetric('pipeline_queue_depth', activeRecords.length, { queue: label, storage_mode: revenueStorageMode() }, { kind: 'gauge' });
    recordMetric('pipeline_queue_oldest_age_seconds', age * 60, { queue: label, storage_mode: revenueStorageMode() }, { kind: 'gauge' });
    if (age > maxStallMinutes && activeRecords.length > 0) {
      activeStalls.push({ queue: label, depth: activeRecords.length, oldestAgeMinutes: oldestAgeMinutes[label] });
    }
    if (label === 'outcomes') {
      for (const record of records) {
        const outcome = String(record.status || 'UNKNOWN').toUpperCase();
        terminalOutcomes[outcome] = (terminalOutcomes[outcome] || 0) + 1;
        if (outcome === 'MONEY_EVENT' && Number(record.payload?.attributableValue || 0) > 0) {
          verifiedRevenueEvents += 1;
        }
      }
    }
  }
  return {
    status: activeStalls.length ? 'STALLED' : 'HEALTHY',
    storageMode: revenueStorageMode(), queueDepth, oldestAgeMinutes, activeStalls,
    terminalOutcomes, verifiedRevenueEvents,
    generatedAt: now.toISOString()
  };
}

export function evaluateOperationalAlerts({ now = new Date(), progressWindowMinutes = 30, providerErrorThreshold = 0.5 } = {}) {
  const alerts = [];
  const completedStages = spans.filter(span => span.name.startsWith('pipeline.') && span.status === 'OK');
  const latestProgress = completedStages.reduce((latest, span) => Math.max(latest, new Date(span.finishedAt || 0).getTime()), 0);
  if (latestProgress && now.getTime() - latestProgress > progressWindowMinutes * 60_000) {
    alerts.push({ code: 'PIPELINE_NO_PROGRESS', severity: 'warning', runbook: 'docs/OBSERVABILITY.md#pipeline-no-progress' });
  }
  const providerSamples = [...metrics.values()].filter(metric => metric.name === 'provider_requests_total');
  const total = providerSamples.reduce((sum, metric) => sum + metric.sum, 0);
  const errors = providerSamples.filter(metric => metric.labels.outcome === 'error').reduce((sum, metric) => sum + metric.sum, 0);
  if (total > 0 && errors / total >= providerErrorThreshold) {
    alerts.push({ code: 'PROVIDER_ERROR_RATE', severity: 'warning', runbook: 'docs/OBSERVABILITY.md#provider-error-rate' });
  }
  return alerts;
}

export function getObservabilitySnapshot({ includeTraces = true } = {}) {
  return {
    mode: exporter ? 'exporter' : 'local-no-export',
    retention: { maxSpans: MAX_SPANS, processLocal: true, sampling: 'all-local-spans' },
    metrics: [...metrics.values()].map(metric => ({ ...metric })),
    traces: includeTraces ? spans.map(span => ({ ...span, events: [...span.events] })) : undefined,
    alerts: evaluateOperationalAlerts(),
    generatedAt: new Date().toISOString()
  };
}

export function resetObservabilityForTesting() {
  spans.length = 0;
  metrics.clear();
  exporter = null;
}
