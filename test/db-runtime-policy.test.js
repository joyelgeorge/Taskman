import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDatabaseRuntimePolicy,
  parseBoundedInteger,
  poolSnapshot,
  safeDatabaseErrorCode
} from '../src/db-runtime-policy.js';
import { runTransaction, setTransactionBudgets } from '../src/db.js';

test('database runtime policy uses bounded production defaults', () => {
  const policy = createDatabaseRuntimePolicy({});
  assert.equal(policy.poolMax, 5);
  assert.equal(policy.connectionTimeoutMs, 5_000);
  assert.equal(policy.statementTimeoutMs, 30_000);
  assert.equal(policy.queryTimeoutMs, 35_000);
  assert.equal(policy.lockTimeoutMs, 5_000);
});

test('database runtime policy rejects invalid and inconsistent values without echoing them', () => {
  const secretLikeValue = 'postgresql://secret@example.invalid/db';
  assert.throws(
    () => parseBoundedInteger('PGPOOL_MAX', secretLikeValue, { defaultValue: 5, min: 1, max: 50 }),
    error => error.code === 'INVALID_DATABASE_RUNTIME_CONFIG' && !error.message.includes(secretLikeValue)
  );
  assert.throws(
    () => createDatabaseRuntimePolicy({ PG_STATEMENT_TIMEOUT_MS: '5000', PG_QUERY_TIMEOUT_MS: '4000' }),
    { code: 'INVALID_DATABASE_RUNTIME_CONFIG' }
  );
});

test('database error classification and pool snapshot expose no raw message', () => {
  const error = Object.assign(new Error('password=do-not-log'), { code: 'ECONNRESET' });
  assert.equal(safeDatabaseErrorCode(error), 'ECONNRESET');
  assert.equal(safeDatabaseErrorCode(new Error('sensitive detail')), 'DATABASE_UNAVAILABLE');
  assert.deepEqual(poolSnapshot({ totalCount: 4, idleCount: 2, waitingCount: 3 }), {
    total: 4, idle: 2, waiting: 3, lastError: null
  });
});

test('transaction budgets are applied locally with validated numeric policy', async () => {
  const statements = [];
  const client = { query: async sql => { statements.push(sql); } };
  await setTransactionBudgets(client, {
    statementTimeoutMs: 1200,
    lockTimeoutMs: 300,
    idleTransactionTimeoutMs: 1500
  });
  assert.deepEqual(statements, [
    "SET LOCAL statement_timeout = '1200ms'",
    "SET LOCAL lock_timeout = '300ms'",
    "SET LOCAL idle_in_transaction_session_timeout = '1500ms'"
  ]);
});

test('transaction failures roll back and callers can release the client', async () => {
  const statements = [];
  const client = { query: async sql => { statements.push(sql); } };
  await assert.rejects(
    runTransaction(client, async () => { throw Object.assign(new Error('boom'), { code: '57014' }); }),
    { code: '57014' }
  );
  assert.equal(statements[0], 'BEGIN');
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.ok(!statements.includes('COMMIT'));
});
