import { databaseEnabled, pool } from './db.js';

export const CONCURRENCY_POLICY = Object.freeze({
  FORBID: 'FORBID',
  QUEUE_ONE: 'QUEUE_ONE',
  ALLOW: 'ALLOW'
});

const VALID_POLICIES = new Set(Object.values(CONCURRENCY_POLICY));
const states = new Map();

export function normalizeConcurrencyPolicy(value, { allowConcurrent = false } = {}) {
  const policy = String(value || CONCURRENCY_POLICY.FORBID).trim().toUpperCase();
  if (!VALID_POLICIES.has(policy)) {
    const error = new Error(`Unsupported concurrency policy: ${policy}`);
    error.code = 'INVALID_CONCURRENCY_POLICY';
    error.statusCode = 400;
    throw error;
  }
  if (policy === CONCURRENCY_POLICY.ALLOW && !allowConcurrent) {
    const error = new Error('ALLOW concurrency requires explicit allowConcurrent=true');
    error.code = 'CONCURRENT_EXECUTION_NOT_AUTHORIZED';
    error.statusCode = 400;
    throw error;
  }
  return policy;
}

function stateFor(key, policy) {
  if (!states.has(key)) {
    states.set(key, {
      key, policy, active: 0, queued: false, started: 0, completed: 0,
      skipped: 0, coalesced: 0, lastOutcome: null, updatedAt: null
    });
  }
  const state = states.get(key);
  state.policy = policy;
  return state;
}

function record(state, outcome, now = new Date()) {
  state.lastOutcome = outcome;
  state.updatedAt = now.toISOString();
  if (outcome === 'STARTED') state.started += 1;
  if (outcome === 'COMPLETED' || outcome === 'FAILED') state.completed += 1;
  if (outcome === 'SKIPPED') state.skipped += 1;
  if (outcome === 'COALESCED') state.coalesced += 1;
}

export function getConcurrencyStatus() {
  return [...states.values()].map(state => ({ ...state }));
}

export function resetConcurrencyStateForTesting() {
  states.clear();
}

export async function acquirePostgresExecutionSlot(key) {
  if (!databaseEnabled || !pool) {
    return { acquired: true, durable: false, release: async () => {} };
  }
  const client = await pool.connect();
  let released = false;
  try {
    const result = await client.query(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [String(key)]
    );
    if (!result.rows[0]?.acquired) {
      client.release();
      return { acquired: false, durable: true, release: async () => {} };
    }
    return {
      acquired: true,
      durable: true,
      release: async () => {
        if (released) return;
        released = true;
        try {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [String(key)]);
        } finally {
          client.release();
        }
      }
    };
  } catch (error) {
    client.release();
    throw error;
  }
}

async function notify(onOutcome, payload) {
  if (typeof onOutcome === 'function') await onOutcome(payload);
}

export async function executeWithConcurrencyPolicy(key, executeFn, {
  policy: requestedPolicy = CONCURRENCY_POLICY.FORBID,
  allowConcurrent = false,
  acquireSlot = acquirePostgresExecutionSlot,
  onOutcome = null
} = {}) {
  if (!key) throw new Error('concurrency key is required');
  if (typeof executeFn !== 'function') throw new Error('executeFn is required');
  const policy = normalizeConcurrencyPolicy(requestedPolicy, { allowConcurrent });
  const state = stateFor(String(key), policy);

  if (policy === CONCURRENCY_POLICY.ALLOW) {
    state.active += 1;
    try {
      record(state, 'STARTED');
      await notify(onOutcome, { key, policy, outcome: 'STARTED', durable: false });
      const value = await executeFn({ queued: false });
      record(state, 'COMPLETED');
      await notify(onOutcome, { key, policy, outcome: 'COMPLETED', durable: false });
      return value;
    } catch (error) {
      record(state, 'FAILED');
      await notify(onOutcome, { key, policy, outcome: 'FAILED', durable: false, errorCode: error.code || 'EXECUTION_FAILED' });
      throw error;
    } finally {
      state.active -= 1;
    }
  }

  if (state.active > 0) {
    if (policy === CONCURRENCY_POLICY.QUEUE_ONE) {
      state.queued = true;
      record(state, 'COALESCED');
      const outcome = { queued: true, coalesced: true, outcome: 'COALESCED', policy, key };
      await notify(onOutcome, outcome);
      return outcome;
    }
    record(state, 'SKIPPED');
    const outcome = { skipped: true, outcome: 'SKIPPED', reason: 'in_flight_overlap', policy, key };
    await notify(onOutcome, outcome);
    return outcome;
  }

  state.active = 1;
  let firstResult;
  let queuedRun = false;
  try {
    do {
      state.queued = false;
      const slot = await acquireSlot(String(key));
      if (!slot?.acquired) {
        const outcomeName = policy === CONCURRENCY_POLICY.QUEUE_ONE ? 'COALESCED' : 'SKIPPED';
        record(state, outcomeName);
        const outcome = {
          skipped: policy === CONCURRENCY_POLICY.FORBID,
          queued: policy === CONCURRENCY_POLICY.QUEUE_ONE,
          coalesced: policy === CONCURRENCY_POLICY.QUEUE_ONE,
          outcome: outcomeName,
          reason: 'durable_overlap',
          durable: Boolean(slot?.durable),
          policy,
          key
        };
        await notify(onOutcome, outcome);
        return outcome;
      }

      try {
        record(state, 'STARTED');
        await notify(onOutcome, { key, policy, outcome: 'STARTED', durable: Boolean(slot.durable), queuedRun });
        const result = await executeFn({ queued: queuedRun });
        if (!queuedRun) firstResult = result;
        record(state, 'COMPLETED');
        await notify(onOutcome, { key, policy, outcome: 'COMPLETED', durable: Boolean(slot.durable), queuedRun });
      } catch (error) {
        record(state, 'FAILED');
        await notify(onOutcome, {
          key, policy, outcome: 'FAILED', durable: Boolean(slot.durable), queuedRun,
          errorCode: error.code || 'EXECUTION_FAILED'
        });
        throw error;
      } finally {
        await slot.release();
      }
      queuedRun = state.queued && policy === CONCURRENCY_POLICY.QUEUE_ONE;
    } while (queuedRun);
    return firstResult;
  } finally {
    state.active = 0;
    state.queued = false;
  }
}

export function executeBrainWithConcurrencyPolicy(executeFn, options = {}) {
  return executeWithConcurrencyPolicy('brain-cycle', executeFn, options);
}

