import test from 'node:test';
import assert from 'node:assert/strict';
import { STORE_STATE, readStore, anyUnknown } from '../src/store-state.js';

// The bug this vocabulary exists to kill: with no DATABASE_URL, a ledger read
// returns an empty array, which is byte-identical to a reachable database
// holding zero rows. A caller cannot tell "no money" from "no database".

test('an unconfigured store reports unknown, and refuses to supply a count', async () => {
  const result = await readStore({
    label: 'settlements',
    enabled: false,
    read: async () => { throw new Error('read must not be attempted'); }
  });

  assert.equal(result.state, STORE_STATE.UNKNOWN);
  // The bite: a zero here is the whole bug. It must not be reachable.
  assert.equal(result.count, null);
  assert.notEqual(result.count, 0);
  assert.match(result.reason, /not configured/i);
});

test('a reachable store holding nothing reports empty, with a count of zero', async () => {
  const result = await readStore({ label: 'settlements', enabled: true, read: async () => [] });

  assert.equal(result.state, STORE_STATE.EMPTY);
  assert.equal(result.count, 0);
  assert.equal(result.reason, null);
});

test('a reachable store holding rows reports verified', async () => {
  const result = await readStore({
    label: 'settlements', enabled: true, read: async () => [{ id: 'a' }, { id: 'b' }]
  });

  assert.equal(result.state, STORE_STATE.VERIFIED);
  assert.equal(result.count, 2);
});

test('a store that throws reports unknown and names the failure, never zero', async () => {
  const result = await readStore({
    label: 'settlements', enabled: true,
    read: async () => { throw new Error('ECONNREFUSED 10.0.0.1:5432'); }
  });

  assert.equal(result.state, STORE_STATE.UNKNOWN);
  assert.equal(result.count, null);
  assert.match(result.reason, /ECONNREFUSED/);
});

test('anyUnknown is true when a single store could not answer', () => {
  const verified = { state: STORE_STATE.VERIFIED };
  const empty = { state: STORE_STATE.EMPTY };
  const unknown = { state: STORE_STATE.UNKNOWN };

  assert.equal(anyUnknown([verified, empty]), false);
  assert.equal(anyUnknown([verified, unknown, empty]), true);
});

// The bug at its source: money-ledger's own read, made honest.
test('settlementPosition reports unknown rather than an empty list when the ledger is unreachable', async () => {
  const { settlementPosition } = await import('../src/money-ledger.js');

  const blind = await settlementPosition({ enabled: false });
  assert.equal(blind.state, STORE_STATE.UNKNOWN);
  assert.equal(blind.count, null);
  assert.notEqual(blind.count, 0);

  const seeing = await settlementPosition({ enabled: true, read: async () => [] });
  assert.equal(seeing.state, STORE_STATE.EMPTY);
  assert.equal(seeing.count, 0);
});
