import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RELEASE_COMPATIBILITY_MANIFEST,
  validateSchemaCompatibility,
  runDeploymentReadinessSmokeCheck,
  generateDeploymentEvidence
} from '../src/deployment-compatibility.js';

test('validateSchemaCompatibility permits supported versions and rejects incompatible ones', () => {
  // Supported range: 1 to 23
  const valid1 = validateSchemaCompatibility({ targetSchemaVersion: 1 });
  assert.equal(valid1.compatible, true);

  const valid23 = validateSchemaCompatibility({ targetSchemaVersion: 23 });
  assert.equal(valid23.compatible, true);

  // Incompatible (version too high or negative)
  const tooHigh = validateSchemaCompatibility({ targetSchemaVersion: 99 });
  assert.equal(tooHigh.compatible, false);
  assert.ok(tooHigh.reason.includes('exceeds max tested schema'));

  const invalid = validateSchemaCompatibility({ targetSchemaVersion: 0 });
  assert.equal(invalid.compatible, false);
});

test('runDeploymentReadinessSmokeCheck executes synthetic verification with zero side effects', async () => {
  const result = await runDeploymentReadinessSmokeCheck();
  assert.equal(result.ok, true);
  assert.equal(result.sideEffectsCreated, 0);
  assert.ok(result.syntheticActionsVerified.length > 0);
});

test('generateDeploymentEvidence compiles audit proof and binds rollback target', () => {
  const smoke = { ok: true, sideEffectsCreated: 0 };
  const evidence = generateDeploymentEvidence({
    releaseSha: 'abcdef123456',
    previousReleaseSha: '123456abcdef',
    schemaVersion: 23,
    smokeResult: smoke
  });

  assert.ok(evidence.id);
  assert.equal(evidence.releaseSha, 'abcdef123456');
  assert.equal(evidence.schemaVersion, 23);
  assert.equal(evidence.rollbackTarget.sha, '123456abcdef');
  assert.equal(evidence.rollbackTarget.safe, true);

  // Incompatible schema version throws and blocks deployment
  assert.throws(() => generateDeploymentEvidence({
    releaseSha: 'badsha',
    schemaVersion: 999,
    smokeResult: smoke
  }), /Deployment blocked due to schema incompatibility/);
});
