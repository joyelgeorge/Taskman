import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RISK_LEVELS,
  MERGE_TRAIN_STATUS,
  classifyRisk,
  evaluateMergeGates,
  saveMergeTrainRecord,
  listMergeTrainRecords,
  processMergeTrainStep,
  resetMergeTrainMemory
} from '../src/merge-train.js';

test('classifyRisk assigns LOW, MEDIUM, and HIGH according to affected files', () => {
  assert.equal(classifyRisk(['README.md', 'docs/TARGET_DESIGN.md']), RISK_LEVELS.LOW);
  assert.equal(classifyRisk(['src/server.js', 'src/worker.js']), RISK_LEVELS.MEDIUM);
  assert.equal(classifyRisk(['db/migrations/015_usage.sql', 'src/server.js']), RISK_LEVELS.HIGH);
  assert.equal(classifyRisk(['src/money-ledger.js']), RISK_LEVELS.HIGH);
});

test('evaluateMergeGates requires headSha match and clean mergeable state', async () => {
  const pr = {
    title: 'Clean PR',
    body: 'Closes #1',
    head: { sha: 'sha-123' },
    currentSha: 'sha-123',
    mergeable: true,
    mergeable_state: 'clean'
  };
  const verdicts = await evaluateMergeGates({
    pr,
    riskLevel: RISK_LEVELS.LOW,
    testSuiteResult: { passed: true },
    ciChecks: [{ name: 'test', status: 'completed', conclusion: 'success' }]
  });
  assert.equal(verdicts.allPassed, true);

  // Stale SHA fails
  const staleVerdicts = await evaluateMergeGates({
    pr: { ...pr, currentSha: 'sha-stale' },
    riskLevel: RISK_LEVELS.LOW,
    testSuiteResult: { passed: true }
  });
  assert.equal(staleVerdicts.allPassed, false);
  assert.equal(staleVerdicts.headShaMatch, false);

  // Conflicting state fails
  const conflictVerdicts = await evaluateMergeGates({
    pr: { ...pr, mergeable: false, mergeable_state: 'dirty' },
    riskLevel: RISK_LEVELS.LOW,
    testSuiteResult: { passed: true }
  });
  assert.equal(conflictVerdicts.allPassed, false);
  assert.equal(conflictVerdicts.mergeable, false);
});

test('evaluateMergeGates enforces high risk integration requirement', async () => {
  const pr = {
    title: 'High Risk Migration',
    body: 'Closes #2',
    head: { sha: 'sha-999' },
    currentSha: 'sha-999',
    mergeable: true,
    mergeable_state: 'clean'
  };

  // High risk without integration result fails
  const noInteg = await evaluateMergeGates({
    pr,
    riskLevel: RISK_LEVELS.HIGH,
    testSuiteResult: { passed: true },
    integrationResult: null,
    ciChecks: [{ name: 'test', status: 'completed', conclusion: 'success' }]
  });
  assert.equal(noInteg.allPassed, false);
  assert.equal(noInteg.riskGatePassed, false);

  // High risk with integration passed succeeds
  const withInteg = await evaluateMergeGates({
    pr,
    riskLevel: RISK_LEVELS.HIGH,
    testSuiteResult: { passed: true },
    integrationResult: { passed: true },
    ciChecks: [{ name: 'test', status: 'completed', conclusion: 'success' }]
  });
  assert.equal(withInteg.allPassed, true);
  assert.equal(withInteg.riskGatePassed, true);
});

test('processMergeTrainStep merges top candidate serially and verifies canary', async () => {
  resetMergeTrainMemory();
  const repo = 'test/repo';
  const prs = [
    {
      number: 10,
      head: { sha: 'sha-10' },
      headSha: 'sha-10',
      mergeable: true,
      mergeable_state: 'clean',
      changedFiles: ['README.md']
    },
    {
      number: 11,
      head: { sha: 'sha-11' },
      headSha: 'sha-11',
      mergeable: true,
      mergeable_state: 'clean',
      changedFiles: ['src/server.js']
    }
  ];

  let mergeCalledWith = null;
  const mockMergePr = async (params) => {
    mergeCalledWith = params;
    return { sha: 'merged-sha-10' };
  };

  // 1. Process first PR
  const res1 = await processMergeTrainStep({
    repo,
    candidatePrs: prs,
    mergePrFn: mockMergePr,
    testRunnerFn: async () => ({ passed: true }),
    canaryObserverFn: async () => ({ healthy: true })
  });

  assert.equal(res1.ok, true);
  assert.equal(res1.prNumber, 10);
  assert.equal(res1.status, 'MERGED_HEALTHY');
  assert.equal(mergeCalledWith.prNumber, 10);

  const records = await listMergeTrainRecords({ repo });
  assert.equal(records.length, 1);
  assert.equal(records[0].prNumber, 10);
  assert.equal(records[0].status, MERGE_TRAIN_STATUS.MERGED);
  assert.equal(records[0].postMergeStatus, 'HEALTHY');
});

test('processMergeTrainStep triggers rollback when canary fails post-merge', async () => {
  resetMergeTrainMemory();
  const repo = 'test/repo';
  const prs = [
    {
      number: 25,
      head: { sha: 'sha-25' },
      headSha: 'sha-25',
      mergeable: true,
      mergeable_state: 'clean',
      changedFiles: ['src/app.js']
    }
  ];

  let rollbackCalled = false;
  const mockMergePr = async () => ({ sha: 'merged-commit-25' });
  const mockCanary = async () => ({ healthy: false, reason: 'Error spike detected in canary window' });
  const mockRollback = async ({ mergeSha, reason }) => {
    rollbackCalled = true;
    return { rolledBack: true, sha: 'revert-commit-sha-25' };
  };

  const res = await processMergeTrainStep({
    repo,
    candidatePrs: prs,
    mergePrFn: mockMergePr,
    testRunnerFn: async () => ({ passed: true }),
    canaryObserverFn: mockCanary,
    rollbackFn: mockRollback
  });

  assert.equal(res.ok, false);
  assert.equal(res.status, 'ROLLED_BACK');
  assert.equal(rollbackCalled, true);
  assert.equal(res.rollbackSha, 'revert-commit-sha-25');

  const records = await listMergeTrainRecords({ repo });
  assert.equal(records[0].status, MERGE_TRAIN_STATUS.ROLLED_BACK);
  assert.equal(records[0].postMergeStatus, 'REGRESSION_DETECTED');
});
