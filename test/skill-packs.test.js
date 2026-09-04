import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerSkillPack,
  getSkillPack,
  listSkillPacks,
  extractSkillContextFragment,
  executeSkillPack,
  resetSkillPacksRegistry
} from '../src/skill-packs.js';

test('registerSkillPack registers versioned and immutable packs', () => {
  resetSkillPacksRegistry();

  const pack = registerSkillPack({
    skillId: 'github-bounty',
    version: '1.0.0',
    domain: 'software_engineering',
    supportedTaskClasses: ['pr_fix', 'issue_reproduction'],
    requiredCapabilities: ['github:pull_request:write'],
    qualificationRules: ['issue_has_bounty_label', 'repo_has_ci'],
    execute: async (input) => ({ fixApplied: true, issue: input.issueId })
  });

  assert.equal(pack.skillId, 'github-bounty');
  assert.equal(pack.version, '1.0.0');

  // Attempting to re-register identical version throws
  assert.throws(() => registerSkillPack({
    skillId: 'github-bounty',
    version: '1.0.0'
  }), /already registered/);

  // Registering a new version succeeds
  const v2 = registerSkillPack({
    skillId: 'github-bounty',
    version: '1.1.0',
    domain: 'software_engineering',
    supportedTaskClasses: ['pr_fix'],
    execute: async () => ({ v2: true })
  });
  assert.equal(v2.version, '1.1.0');
});

test('getSkillPack resolves specific version or highest active version', () => {
  resetSkillPacksRegistry();

  registerSkillPack({ skillId: 'invoice-recovery', version: '1.0.0', domain: 'fintech' });
  registerSkillPack({ skillId: 'invoice-recovery', version: '1.2.0', domain: 'fintech' });
  registerSkillPack({ skillId: 'invoice-recovery', version: '1.1.0', domain: 'fintech' });

  const exact = getSkillPack('invoice-recovery', '1.0.0');
  assert.equal(exact.version, '1.0.0');

  const latest = getSkillPack('invoice-recovery');
  assert.equal(latest.version, '1.2.0');
});

test('extractSkillContextFragment provides narrow context without polluting model prompt', () => {
  resetSkillPacksRegistry();

  const pack = registerSkillPack({
    skillId: 'treds-onboarding',
    version: '1.0.0',
    domain: 'finance',
    qualificationRules: ['msme_certificate_verified', 'bank_statement_provided'],
    schemas: { invoiceSchema: { type: 'object' } },
    knownFailurePatterns: ['blurred_gst_certificate', 'signature_missing']
  });

  const frag = extractSkillContextFragment(pack, 'onboarding');
  assert.equal(frag.skillId, 'treds-onboarding');
  assert.equal(frag.qualificationRules.length, 2);
  assert.equal(frag.knownFailurePatterns.length, 2);
});

test('executeSkillPack enforces task class validation and capability gating', async () => {
  resetSkillPacksRegistry();

  registerSkillPack({
    skillId: 'reconciliation-skill',
    version: '1.0.0',
    domain: 'accounting',
    supportedTaskClasses: ['fiverr_reconcile'],
    requiredCapabilities: ['fs:read_csv', 'ledger:write'],
    execute: async (input) => ({ reconciledRows: input.rows.length })
  });

  // Missing capability throws
  await assert.rejects(
    () => executeSkillPack({
      skillId: 'reconciliation-skill',
      taskClass: 'fiverr_reconcile',
      taskInput: { rows: [1, 2, 3] },
      grantedCapabilities: ['fs:read_csv'] // missing ledger:write
    }),
    /Missing required capability 'ledger:write'/
  );

  // Unsupported task class throws
  await assert.rejects(
    () => executeSkillPack({
      skillId: 'reconciliation-skill',
      taskClass: 'general_translation',
      taskInput: { rows: [] },
      grantedCapabilities: ['fs:read_csv', 'ledger:write']
    }),
    /not supported by skill pack/
  );

  // Valid execution
  const res = await executeSkillPack({
    skillId: 'reconciliation-skill',
    taskClass: 'fiverr_reconcile',
    taskInput: { rows: [1, 2, 3] },
    grantedCapabilities: ['fs:read_csv', 'ledger:write']
  });
  assert.equal(res.skillId, 'reconciliation-skill');
  assert.equal(res.version, '1.0.0');
  assert.equal(res.outcome.reconciledRows, 3);
});
