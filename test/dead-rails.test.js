import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDeadRails, DEAD_RAILS } from '../src/rails/dead-rails.js';
import { discoverRail, railStatus, enableRailExecution } from '../src/rails/index.js';
import { isRailEnabled, getRailState, setRailEnabled, resetLedgerMemory } from '../src/money-ledger.js';
import { discoverFromRealSources } from '../src/workers/discover.js';

test('both dead rails are disabled with a recorded, evidence-bearing reason', async () => {
  resetLedgerMemory();
  const seeded = await seedDeadRails();
  assert.deepEqual(seeded.sort(), ['moltjobs', 'taskforce']);

  for (const { rail } of DEAD_RAILS) {
    assert.equal(await isRailEnabled(rail), false);
    const state = await getRailState(rail);
    assert.match(state.disabled_reason, /Sept 2026/);
  }
});

test('seeding never overwrites a rail a human already re-enabled', async () => {
  resetLedgerMemory();
  await setRailEnabled('taskforce', true);
  const seeded = await seedDeadRails();

  assert.equal(seeded.includes('taskforce'), false, 'a manually-enabled rail must not be silently re-disabled');
  assert.equal(await isRailEnabled('taskforce'), true);
});

test('discoverRail refuses a disabled rail without throwing', async () => {
  resetLedgerMemory();
  await seedDeadRails();
  const result = await discoverRail('taskforce');
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.deepEqual(result.tasks, []);
});

test('enableRailExecution refuses a disabled rail even with a valid gate', async () => {
  resetLedgerMemory();
  await seedDeadRails();
  await assert.rejects(
    () => enableRailExecution('taskforce', {
      payerVerified: true, taskOpen: true, acceptanceCriteriaClear: true, deliveryPathExecutable: true,
      noContradictoryInstructions: true, payoutPathExecutable: true, noRecurringManualStep: true,
      noUpfrontSpend: true, noUnsupportedSigning: true, payout: 1
    }),
    /disabled in the ledger/
  );
});

test('railStatus stays a plain adapter passthrough; ledger state is read separately', async () => {
  // railStatus() must stay exactly listRails() — capability-registry.js's
  // buildCapabilityRegistry() calls it as a synchronous default-parameter value
  // and reads rail.apiKey off the raw adapter, so this cannot become async or
  // remap the shape. Ledger-derived state (whether a rail is actually allowed to
  // spend) lives in getRailState()/railEconomics() instead — see
  // src/rails/index.js's top comment.
  resetLedgerMemory();
  const status = await railStatus();
  const taskforce = status.find(r => r.name === 'taskforce');
  assert.ok(taskforce);
  assert.equal(taskforce.mode, 'read_only');
  assert.equal('apiKey' in taskforce, true, 'capability-registry.js reads rail.apiKey off the raw adapter');

  await seedDeadRails();
  const state = await getRailState('taskforce');
  assert.equal(state.enabled, false, 'the ledger, not railStatus(), is the source of truth for whether a rail may spend');
});

test('the bounty discovery path is a silent no-op while the rail is disabled', async () => {
  resetLedgerMemory();
  await seedDeadRails();
  const discovered = await discoverFromRealSources({ sources: ['bounty'], sampleCandidates: [] });
  assert.deepEqual(discovered, []);
});
