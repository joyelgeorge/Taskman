import { databaseEnabled, query } from './db.js';
import { createHash } from 'node:crypto';

export const BILLABLE_METRICS = Object.freeze({
  AI_TOKENS: Object.freeze({ id: 'ai_tokens', version: 1, unit: 'token' }),
  SUCCESSFUL_RUNS: Object.freeze({ id: 'successful_runs', version: 1, unit: 'run' }),
  CONNECTOR_CALLS: Object.freeze({ id: 'connector_calls', version: 1, unit: 'call' })
});

const metrics = new Map(Object.values(BILLABLE_METRICS).map(metric => [`${metric.id}:${metric.version}`, metric]));
const memory = {
  accounts: new Map(),
  assignments: [],
  entitlements: new Map(),
  events: new Map(),
  exports: new Map()
};

function metricKey(metricId, metricVersion) {
  return `${metricId}:${metricVersion}`;
}

function eventKey({ accountId, metricId, metricVersion, sourceId }) {
  return `${accountId}:${metricId}:${metricVersion}:${sourceId}`;
}

function requireText(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(`${name} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function requireDate(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${name} must be a valid timestamp`);
  return date;
}

function requireQuantity(value, { correction = false } = {}) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || (correction ? quantity >= 0 : quantity <= 0)) {
    throw new TypeError(correction ? 'correction quantity must be negative' : 'quantity must be positive');
  }
  return quantity;
}

function safeProvenance(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = ['runId', 'provider', 'model', 'connector', 'reasonCode'];
  return Object.fromEntries(allowed
    .filter(key => typeof value[key] === 'string' && value[key].length <= 200)
    .map(key => [key, value[key]]));
}

function normalizeMetric(metricId, metricVersion = 1, unit) {
  const id = requireText(metricId, 'metricId', 100);
  const version = Number(metricVersion);
  if (!Number.isInteger(version) || version < 1) throw new TypeError('metricVersion must be a positive integer');
  const metric = metrics.get(metricKey(id, version));
  if (!metric) throw new Error('UNKNOWN_BILLABLE_METRIC');
  if (unit && unit !== metric.unit) throw new Error('BILLABLE_UNIT_MISMATCH');
  return metric;
}

function activeMemoryAssignment(accountId, at) {
  return memory.assignments
    .filter(item => item.accountId === accountId && item.effectiveFrom <= at && (!item.effectiveUntil || item.effectiveUntil > at))
    .sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0] || null;
}

export function resetMeteringForTesting({ seedDevelopment = false } = {}) {
  memory.accounts.clear();
  memory.assignments.length = 0;
  memory.entitlements.clear();
  memory.events.clear();
  memory.exports.clear();
  if (seedDevelopment) seedDevelopmentPlan();
}

export function seedDevelopmentPlan() {
  memory.accounts.set('local-default', { id: 'local-default', status: 'active' });
  memory.assignments.push({
    accountId: 'local-default', planId: 'development', planVersion: 1,
    effectiveFrom: new Date('2020-01-01T00:00:00Z'), effectiveUntil: null
  });
  for (const metric of Object.values(BILLABLE_METRICS)) {
    memory.entitlements.set(`development:1:${metric.id}:${metric.version}`, {
      hardLimit: metric.id === 'ai_tokens' ? 1_000_000 : 10_000,
      softLimit: metric.id === 'ai_tokens' ? 800_000 : 8_000
    });
  }
}

export function configureMemoryAccountPlan({
  accountId, planId = 'test', planVersion = 1, effectiveFrom = new Date(0), effectiveUntil = null, entitlements = []
}) {
  if (databaseEnabled) throw new Error('Memory plan configuration is unavailable in PostgreSQL mode');
  const id = requireText(accountId, 'accountId');
  const plan = requireText(planId, 'planId');
  memory.accounts.set(id, { id, status: 'active' });
  memory.assignments.push({
    accountId: id, planId: plan, planVersion,
    effectiveFrom: requireDate(effectiveFrom, 'effectiveFrom'),
    effectiveUntil: effectiveUntil ? requireDate(effectiveUntil, 'effectiveUntil') : null
  });
  for (const entry of entitlements) {
    const metric = normalizeMetric(entry.metricId, entry.metricVersion);
    memory.entitlements.set(`${plan}:${planVersion}:${metric.id}:${metric.version}`, {
      hardLimit: entry.hardLimit == null ? null : Number(entry.hardLimit),
      softLimit: entry.softLimit == null ? null : Number(entry.softLimit)
    });
  }
}

export async function initializeMetering() {
  if (!databaseEnabled && !memory.accounts.size) seedDevelopmentPlan();
  return { enabled: true, durable: databaseEnabled, metrics: Object.values(BILLABLE_METRICS) };
}

export async function checkEntitlement({ accountId, metricId, metricVersion = 1, proposedQuantity = 1, at = new Date() }) {
  const account = requireText(accountId, 'accountId');
  const metric = normalizeMetric(metricId, metricVersion);
  const quantity = requireQuantity(proposedQuantity);
  const when = requireDate(at, 'at');

  if (!databaseEnabled) {
    const assignment = activeMemoryAssignment(account, when);
    if (!assignment || !memory.accounts.has(account)) return { allowed: false, code: 'ENTITLEMENT_UNKNOWN' };
    if (process.env.NODE_ENV === 'production' && assignment.planId === 'development') {
      return { allowed: false, code: 'DEVELOPMENT_PLAN_FORBIDDEN' };
    }
    const entitlement = memory.entitlements.get(`${assignment.planId}:${assignment.planVersion}:${metric.id}:${metric.version}`);
    if (!entitlement) return { allowed: false, code: 'ENTITLEMENT_UNKNOWN' };
    const used = [...memory.events.values()]
      .filter(event => event.accountId === account && event.metricId === metric.id && event.metricVersion === metric.version &&
        event.occurredAt >= assignment.effectiveFrom && (!assignment.effectiveUntil || event.occurredAt < assignment.effectiveUntil))
      .reduce((sum, event) => sum + event.quantity, 0);
    const remaining = entitlement.hardLimit == null ? null : Math.max(0, entitlement.hardLimit - used);
    return {
      allowed: remaining == null || quantity <= remaining,
      code: remaining != null && quantity > remaining ? 'ENTITLEMENT_EXHAUSTED' : 'ENTITLED',
      accountId: account, planId: assignment.planId, planVersion: assignment.planVersion,
      metricId: metric.id, metricVersion: metric.version, unit: metric.unit,
      used, hardLimit: entitlement.hardLimit, softLimit: entitlement.softLimit, remaining
    };
  }

  const result = await query(`
    SELECT apa.plan_id, apa.plan_version, apa.effective_from, apa.effective_until,
           pe.hard_limit, pe.soft_limit,
           COALESCE(sum(me.quantity), 0)::numeric AS used
    FROM billing_accounts ba
    JOIN LATERAL (
      SELECT * FROM account_plan_assignments
      WHERE account_id=ba.id AND effective_from <= $3
        AND (effective_until IS NULL OR effective_until > $3)
      ORDER BY effective_from DESC LIMIT 1
    ) apa ON TRUE
    JOIN plan_entitlements pe
      ON pe.plan_id=apa.plan_id AND pe.plan_version=apa.plan_version
      AND pe.metric_id=$2 AND pe.metric_version=$4
    LEFT JOIN meter_events me
      ON me.account_id=ba.id AND me.metric_id=$2 AND me.metric_version=$4
      AND me.occurred_at >= apa.effective_from
      AND (apa.effective_until IS NULL OR me.occurred_at < apa.effective_until)
    WHERE ba.id=$1 AND ba.status='active'
    GROUP BY apa.plan_id, apa.plan_version, apa.effective_from, apa.effective_until, pe.hard_limit, pe.soft_limit
  `, [account, metric.id, when, metric.version]);
  if (!result.rowCount) return { allowed: false, code: 'ENTITLEMENT_UNKNOWN' };
  const row = result.rows[0];
  if (process.env.NODE_ENV === 'production' && row.plan_id === 'development') {
    return { allowed: false, code: 'DEVELOPMENT_PLAN_FORBIDDEN' };
  }
  const used = Number(row.used);
  const hardLimit = row.hard_limit == null ? null : Number(row.hard_limit);
  const remaining = hardLimit == null ? null : Math.max(0, hardLimit - used);
  return {
    allowed: remaining == null || quantity <= remaining,
    code: remaining != null && quantity > remaining ? 'ENTITLEMENT_EXHAUSTED' : 'ENTITLED',
    accountId: account, planId: row.plan_id, planVersion: row.plan_version,
    metricId: metric.id, metricVersion: metric.version, unit: metric.unit,
    used, hardLimit, softLimit: row.soft_limit == null ? null : Number(row.soft_limit), remaining
  };
}

export async function requireEntitlement(input) {
  const decision = await checkEntitlement(input);
  if (!decision.allowed) {
    const error = new Error(decision.code);
    error.code = decision.code;
    error.entitlement = decision;
    throw error;
  }
  return decision;
}

export async function recordMeterEvent({
  accountId, metricId, metricVersion = 1, quantity, unit, sourceId,
  occurredAt = new Date(), provenance = {}, correctionOf = null
}) {
  const account = requireText(accountId, 'accountId');
  const metric = normalizeMetric(metricId, metricVersion, unit);
  const source = requireText(sourceId, 'sourceId', 300);
  const when = requireDate(occurredAt, 'occurredAt');
  const amount = requireQuantity(quantity, { correction: Boolean(correctionOf) });
  const cleanProvenance = safeProvenance(provenance);
  const key = eventKey({ accountId: account, metricId: metric.id, metricVersion: metric.version, sourceId: source });

  if (!databaseEnabled) {
    if (!memory.accounts.has(account)) throw new Error('UNKNOWN_BILLING_ACCOUNT');
    const existing = memory.events.get(key);
    if (existing) return { inserted: false, event: { ...existing } };
    if (correctionOf && ![...memory.events.values()].some(event => event.id === correctionOf)) {
      throw new Error('CORRECTION_SOURCE_NOT_FOUND');
    }
    const event = Object.freeze({
      id: crypto.randomUUID(), accountId: account, metricId: metric.id, metricVersion: metric.version,
      quantity: amount, unit: metric.unit, sourceId: source, occurredAt: when,
      receivedAt: new Date(), provenance: Object.freeze(cleanProvenance), correctionOf
    });
    memory.events.set(key, event);
    return { inserted: true, event: { ...event } };
  }

  const result = await query(`
    INSERT INTO meter_events
      (account_id, metric_id, metric_version, quantity, unit, source_id, occurred_at, provenance, correction_of)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
    ON CONFLICT (account_id, metric_id, metric_version, source_id) DO NOTHING
    RETURNING *
  `, [account, metric.id, metric.version, amount, metric.unit, source, when, JSON.stringify(cleanProvenance), correctionOf]);
  if (!result.rowCount) {
    const existing = await query(`
      SELECT * FROM meter_events
      WHERE account_id=$1 AND metric_id=$2 AND metric_version=$3 AND source_id=$4
    `, [account, metric.id, metric.version, source]);
    return { inserted: false, event: mapEvent(existing.rows[0]) };
  }
  return { inserted: true, event: mapEvent(result.rows[0]) };
}

function mapEvent(row) {
  return {
    id: row.id, accountId: row.account_id, metricId: row.metric_id, metricVersion: row.metric_version,
    quantity: Number(row.quantity), unit: row.unit, sourceId: row.source_id,
    occurredAt: row.occurred_at, receivedAt: row.received_at,
    provenance: row.provenance || {}, correctionOf: row.correction_of || null
  };
}

export async function recordMeterCorrection({ originalEventId, sourceId, occurredAt = new Date(), provenance = {} }) {
  const originalId = requireText(originalEventId, 'originalEventId');
  if (!databaseEnabled) {
    const original = [...memory.events.values()].find(event => event.id === originalId);
    if (!original) throw new Error('CORRECTION_SOURCE_NOT_FOUND');
    return recordMeterEvent({
      accountId: original.accountId, metricId: original.metricId, metricVersion: original.metricVersion,
      quantity: -original.quantity, unit: original.unit, sourceId, occurredAt, provenance, correctionOf: original.id
    });
  }
  const result = await query('SELECT * FROM meter_events WHERE id=$1', [originalId]);
  if (!result.rowCount) throw new Error('CORRECTION_SOURCE_NOT_FOUND');
  const original = mapEvent(result.rows[0]);
  return recordMeterEvent({
    accountId: original.accountId, metricId: original.metricId, metricVersion: original.metricVersion,
    quantity: -original.quantity, unit: original.unit, sourceId, occurredAt, provenance, correctionOf: original.id
  });
}

function encodeCursor(event) {
  return Buffer.from(JSON.stringify([new Date(event.occurredAt).toISOString(), event.id])).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [occurredAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return { occurredAt: requireDate(occurredAt, 'cursor'), id: requireText(id, 'cursor id') };
  } catch {
    throw new TypeError('cursor is invalid');
  }
}

export async function accountUsageSummary({ accountId, from, to, limit = 50, cursor = null }) {
  const account = requireText(accountId, 'accountId');
  const start = requireDate(from, 'from');
  const end = requireDate(to, 'to');
  if (end <= start) throw new TypeError('to must be after from');
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
  const after = decodeCursor(cursor);

  let events;
  let totals;
  if (!databaseEnabled) {
    const allEvents = [...memory.events.values()]
      .filter(event => event.accountId === account && event.occurredAt >= start && event.occurredAt < end)
      .sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id));
    totals = allEvents.reduce((result, event) => {
      const key = metricKey(event.metricId, event.metricVersion);
      result[key] = (result[key] || 0) + event.quantity;
      return result;
    }, {});
    events = allEvents;
    if (after) events = events.filter(event => event.occurredAt < after.occurredAt ||
      (event.occurredAt.getTime() === after.occurredAt.getTime() && event.id < after.id));
    events = events.slice(0, pageSize + 1);
  } else {
    const [eventResult, totalResult] = await Promise.all([query(`
      SELECT * FROM meter_events
      WHERE account_id=$1 AND occurred_at >= $2 AND occurred_at < $3
        AND ($4::timestamptz IS NULL OR (occurred_at, id) < ($4::timestamptz, $5::uuid))
      ORDER BY occurred_at DESC, id DESC LIMIT $6
    `, [account, start, end, after?.occurredAt || null, after?.id || null, pageSize + 1]), query(`
      SELECT metric_id, metric_version, COALESCE(sum(quantity), 0)::numeric AS quantity
      FROM meter_events
      WHERE account_id=$1 AND occurred_at >= $2 AND occurred_at < $3
      GROUP BY metric_id, metric_version
    `, [account, start, end])]);
    events = eventResult.rows.map(mapEvent);
    totals = Object.fromEntries(totalResult.rows.map(row => [metricKey(row.metric_id, row.metric_version), Number(row.quantity)]));
  }

  const hasMore = events.length > pageSize;
  const page = events.slice(0, pageSize);
  return {
    accountId: account, window: { from: start.toISOString(), to: end.toISOString(), timezone: 'UTC' },
    totals, events: page.map(event => ({ ...event, occurredAt: new Date(event.occurredAt).toISOString(), receivedAt: new Date(event.receivedAt).toISOString() })),
    nextCursor: hasMore && page.length ? encodeCursor(page.at(-1)) : null,
    reconciliationStatus: 'unexported'
  };
}

export function billingExportStatus() {
  return {
    enabled: process.env.TASKMAN_BILLING_EXPORT_ENABLED === 'true',
    mode: 'adapter-only',
    performsCharges: false
  };
}

function exportKeyHash(value) {
  return createHash('sha256').update(requireText(value, 'idempotencyKey', 300)).digest('hex');
}

export function createBillingExportAdapter({ provider, send }) {
  const providerId = requireText(provider, 'provider', 100);
  if (typeof send !== 'function') throw new TypeError('send must be a function');

  return Object.freeze({
    provider: providerId,
    performsCharges: false,
    async exportMeterEvent(event, { idempotencyKey }) {
      if (process.env.TASKMAN_BILLING_EXPORT_ENABLED !== 'true') {
        return { status: 'disabled', provider: providerId, performsCharges: false };
      }
      if (!event?.id || !event?.accountId || !event?.metricId) throw new TypeError('a persisted meter event is required');
      const keyHash = exportKeyHash(idempotencyKey);

      if (!databaseEnabled) {
        const receiptKey = `${providerId}:${event.id}`;
        const existing = memory.exports.get(receiptKey);
        if (existing) return { ...existing, replay: true };
        const receipt = { status: 'pending', provider: providerId, meterEventId: event.id, keyHash, performsCharges: false };
        memory.exports.set(receiptKey, receipt);
        try {
          const response = await send({
            meterEventId: event.id, accountId: event.accountId,
            metricId: event.metricId, metricVersion: event.metricVersion,
            quantity: event.quantity, unit: event.unit,
            occurredAt: new Date(event.occurredAt).toISOString(), idempotencyKey
          });
          Object.assign(receipt, { status: 'exported', providerReference: response?.reference || null });
        } catch (error) {
          Object.assign(receipt, { status: 'failed', errorCode: 'BILLING_EXPORT_FAILED' });
        }
        return { ...receipt, replay: false };
      }

      const claimed = await query(`
        INSERT INTO billing_export_receipts(provider, meter_event_id, export_key_hash, status)
        VALUES ($1,$2,$3,'pending')
        ON CONFLICT DO NOTHING RETURNING *
      `, [providerId, event.id, keyHash]);
      if (!claimed.rowCount) {
        const existing = await query(`
          SELECT * FROM billing_export_receipts WHERE provider=$1 AND meter_event_id=$2
        `, [providerId, event.id]);
        return { status: existing.rows[0]?.status || 'pending', provider: providerId, meterEventId: event.id, replay: true, performsCharges: false };
      }
      try {
        const response = await send({
          meterEventId: event.id, accountId: event.accountId,
          metricId: event.metricId, metricVersion: event.metricVersion,
          quantity: event.quantity, unit: event.unit,
          occurredAt: new Date(event.occurredAt).toISOString(), idempotencyKey
        });
        await query(`
          UPDATE billing_export_receipts SET status='exported', provider_reference=$2, updated_at=now() WHERE id=$1
        `, [claimed.rows[0].id, response?.reference || null]);
        return { status: 'exported', provider: providerId, meterEventId: event.id, replay: false, performsCharges: false };
      } catch {
        await query(`UPDATE billing_export_receipts SET status='failed', updated_at=now() WHERE id=$1`, [claimed.rows[0].id]);
        return { status: 'failed', provider: providerId, meterEventId: event.id, replay: false, performsCharges: false };
      }
    }
  });
}
