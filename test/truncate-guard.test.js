import test from 'node:test';
import assert from 'node:assert/strict';
import { looksEphemeral } from '../src/db.js';

/**
 * CI runs with NODE_ENV=test and a DATABASE_URL, and five test files truncate
 * real tables through resetLedgerMemory and friends. Today the only thing
 * standing between `NODE_ENV=test npm test` on a developer machine and an empty
 * settlements table is that DATABASE_URL happens to be unset there.
 *
 * settlements is empty, so there is nothing to lose right now. That stops being
 * true the day someone pays, and the guard should not have to be remembered on
 * that day.
 */

test('an ephemeral CI or local database is recognised', () => {
  for (const url of [
    'postgresql://taskman:taskman@localhost:5432/taskman_test',
    'postgres://user:pw@127.0.0.1:5432/anything',
    'postgres://user:pw@db.example.com:5432/myapp_test',
    'postgres://user:pw@host/test'
  ]) {
    assert.equal(looksEphemeral(url), true, url);
  }
});

test('a managed production database is not', () => {
  for (const url of [
    'postgres://user:pw@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb?sslmode=require',
    'postgres://user:pw@db.supabase.co:5432/postgres',
    'postgres://user:pw@prod.internal:5432/taskman'
  ]) {
    assert.equal(looksEphemeral(url), false, url);
  }
});

test('an unreadable or absent url is treated as production, not as safe', () => {
  // Failing open here would be the whole bug: an unparseable URL must never be
  // assumed to be a throwaway database.
  assert.equal(looksEphemeral(''), false);
  assert.equal(looksEphemeral(null), false);
  assert.equal(looksEphemeral('not a url at all'), false);
});
