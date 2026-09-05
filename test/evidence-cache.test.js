import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCachedEvidence,
  setCachedEvidence,
  invalidateCachedEvidence,
  resetEvidenceCacheMemory,
  FRESHNESS_CLASS,
  CACHE_STATUS
} from '../src/evidence-cache.js';

test('setCachedEvidence and getCachedEvidence round-trip and increment reuse count', async () => {
  await resetEvidenceCacheMemory();
  const now = new Date('2026-09-04T12:00:00.000Z');

  await setCachedEvidence({
    claimKey: 'repo_stars:joyelgeorge/Taskman',
    normalizedStatement: 'Repository joyelgeorge/Taskman has 42 stars',
    data: { stars: 42 },
    freshnessClass: FRESHNESS_CLASS.DAILY_CHANGING,
    estimatedTokensSaved: 150,
    now
  });

  // Hit 1
  const hit1 = await getCachedEvidence({
    claimKey: 'repo_stars:joyelgeorge/Taskman',
    now: new Date('2026-09-04T13:00:00.000Z')
  });
  assert.ok(hit1);
  assert.equal(hit1.data.stars, 42);
  assert.equal(hit1.reuseCount, 1);

  // Hit 2
  const hit2 = await getCachedEvidence({
    claimKey: 'repo_stars:joyelgeorge/Taskman',
    now: new Date('2026-09-04T14:00:00.000Z')
  });
  assert.equal(hit2.reuseCount, 2);
});

test('expired cache entry returns null and forces refresh', async () => {
  await resetEvidenceCacheMemory();
  const base = new Date('2026-09-04T12:00:00.000Z');

  await setCachedEvidence({
    claimKey: 'pr_status:123',
    normalizedStatement: 'PR 123 is open',
    data: { state: 'open' },
    freshnessClass: FRESHNESS_CLASS.LIVE_STATE, // 15 mins TTL
    now: base
  });

  // Advance time by 20 minutes (past 15m TTL)
  const expired = await getCachedEvidence({
    claimKey: 'pr_status:123',
    now: new Date(base.getTime() + 20 * 60 * 1000)
  });
  assert.equal(expired, null);
});

test('EXECUTION_CRITICAL freshness class always bypasses cache', async () => {
  await resetEvidenceCacheMemory();
  const now = new Date();

  await setCachedEvidence({
    claimKey: 'bank_balance:stripe',
    normalizedStatement: 'Balance is $500',
    data: { balanceCents: 50000 },
    freshnessClass: FRESHNESS_CLASS.LIVE_STATE,
    now
  });

  // Requesting with EXECUTION_CRITICAL must return null to force live refresh
  const result = await getCachedEvidence({
    claimKey: 'bank_balance:stripe',
    requiredFreshness: FRESHNESS_CLASS.EXECUTION_CRITICAL,
    now
  });
  assert.equal(result, null);
});

test('contradiction invalidates cached claim', async () => {
  await resetEvidenceCacheMemory();
  await setCachedEvidence({
    claimKey: 'issue_state:55',
    normalizedStatement: 'Issue 55 is open',
    data: { state: 'open' },
    freshnessClass: FRESHNESS_CLASS.DAILY_CHANGING
  });

  // Contradiction occurs (e.g. Issue was closed)
  const invalidated = await invalidateCachedEvidence({
    claimKey: 'issue_state:55',
    reason: 'Issue was closed upstream'
  });
  assert.equal(invalidated, true);

  const res = await getCachedEvidence({ claimKey: 'issue_state:55' });
  assert.equal(res, null);
});

test('schema revision mismatch invalidates cached claim', async () => {
  await resetEvidenceCacheMemory();
  await setCachedEvidence({
    claimKey: 'schema_fact:v1',
    normalizedStatement: 'Schema v1 format',
    schemaRevision: '1'
  });

  // Query with schemaRevision 2
  const mismatch = await getCachedEvidence({
    claimKey: 'schema_fact:v1',
    currentSchemaRevision: '2'
  });
  assert.equal(mismatch, null);
});
