import test from 'node:test';
import assert from 'node:assert/strict';

import {
  logOutreachAttempt, listOutreachAttempts, resetOutreachLogForTesting
} from '../src/outreach-log.js';
import {
  recordScanned, listScanned, resetScanMemoryForTesting, SCAN_OUTCOME
} from '../packages/core/targets/scan-memory.js';
import {
  upsertRevenueRecord, listRevenueRecords, resetRevenueStoreForTesting
} from '../src/revenue-store.js';
import { CANONICAL_QUEUES } from '../src/orchestration-profiles.js';

/**
 * A reset helper that cannot be shown to reset is the same class of bug as a
 * guard that cannot be shown to fail.
 *
 * `resetOutreachLogForTesting` used to be `mem.attempts.length = 0` and nothing
 * else, so in PostgreSQL mode it was a no-op that reported success. Every test
 * after the first in a file saw the previous ones' rows:
 * `test/outreach-log.test.js` was 13/13 green in memory and 8 failures against
 * PostgreSQL, with counts like `expected 5, actual 67`.
 *
 * These tests run in whichever mode the suite is invoked with, so they only
 * prove anything about PostgreSQL when DATABASE_URL is set — which is the point.
 * In memory mode they pass against the broken implementation too, exactly as the
 * rest of the suite did.
 */

test('resetting the outreach log actually empties it', async () => {
  await resetOutreachLogForTesting();

  await logOutreachAttempt({ lane: 'reset-probe', channel: 'email', prospect: 'someone' });
  assert.equal(
    (await listOutreachAttempts({ lane: 'reset-probe' })).length, 1,
    'precondition: the row has to exist before clearing it proves anything'
  );

  await resetOutreachLogForTesting();

  assert.deepEqual(
    await listOutreachAttempts({ lane: 'reset-probe' }), [],
    'the reset reported success, so the row must be gone from wherever it was stored'
  );
});

test('resetting the scan memory actually empties it', async () => {
  await resetScanMemoryForTesting();

  await recordScanned({ repo: 'octocat/reset-probe', outcome: SCAN_OUTCOME.CLEAN });
  assert.equal(
    (await listScanned()).length, 1,
    'precondition: the row has to exist before clearing it proves anything'
  );

  await resetScanMemoryForTesting();

  assert.deepEqual(await listScanned(), [], 'the reset must clear the durable store too');
});

/**
 * revenue-store had no reset at all, which is why a worker test could claim a
 * queue row left behind by an entirely different file: `Execute recomputes
 * current capability state` passed alone and failed in the full suite, because
 * runExecuteWorker takes whatever is at the head of the queue.
 */
test('resetting the revenue store actually empties it', async () => {
  await resetRevenueStoreForTesting();

  await upsertRevenueRecord({
    queue: CANONICAL_QUEUES.execution,
    noveltyKey: 'reset-probe',
    status: 'NEW',
    priority: 1,
    payload: {}
  });
  assert.equal(
    (await listRevenueRecords(CANONICAL_QUEUES.execution)).length, 1,
    'precondition: the row has to exist before clearing it proves anything'
  );

  await resetRevenueStoreForTesting();

  assert.deepEqual(
    await listRevenueRecords(CANONICAL_QUEUES.execution), [],
    'a queue left dirty makes every worker test depend on which file ran first'
  );
});
