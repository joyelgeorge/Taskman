import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAutonomousEngine,
  resetAutonomousEngineForTesting,
  ENGINE_STATE,
  DEFAULT_TWEAK_CONFIG
} from '../src/autonomous-engine.js';

test.beforeEach(async () => {
  resetAutonomousEngineForTesting();
});

test.afterEach(async () => {
  resetAutonomousEngineForTesting();
});

test('AutonomousEngine: initializes with default stopped state and config', () => {
  const engine = getAutonomousEngine();
  const status = engine.getStatus();

  assert.equal(status.state, ENGINE_STATE.STOPPED);
  assert.equal(status.config.cycleIntervalSec, DEFAULT_TWEAK_CONFIG.cycleIntervalSec);
  assert.equal(status.config.minRewardDollars, DEFAULT_TWEAK_CONFIG.minRewardDollars);
  assert.equal(status.config.autoExecuteDeliverables, true);
  assert.equal(status.metrics.cyclesCompleted, 0);
});

test('AutonomousEngine: transitions cleanly between start, pause, and stop', () => {
  const engine = getAutonomousEngine({ cycleIntervalSec: 60 });

  const startRes = engine.start();
  assert.equal(startRes.ok, true);
  assert.equal(engine.getStatus().state, ENGINE_STATE.RUNNING);

  const pauseRes = engine.pause();
  assert.equal(pauseRes.ok, true);
  assert.equal(engine.getStatus().state, ENGINE_STATE.PAUSED);

  const stopRes = engine.stop();
  assert.equal(stopRes.ok, true);
  assert.equal(engine.getStatus().state, ENGINE_STATE.STOPPED);
});

test('AutonomousEngine: updates tweak configuration parameters safely', () => {
  const engine = getAutonomousEngine();

  const tweakRes = engine.tweak({
    cycleIntervalSec: 5,
    minRewardDollars: 50,
    minExpectedValue: 25,
    autoExecuteDeliverables: false,
    activeRails: ['bounty_scraper', 'code_bounties'],
    aiModel: 'hermes3:latest'
  });

  assert.equal(tweakRes.ok, true);
  const status = engine.getStatus();
  assert.equal(status.config.cycleIntervalSec, 5);
  assert.equal(status.config.minRewardDollars, 50);
  assert.equal(status.config.minExpectedValue, 25);
  assert.equal(status.config.autoExecuteDeliverables, false);
  assert.deepEqual(status.config.activeRails, ['bounty_scraper', 'code_bounties']);
  assert.equal(status.config.aiModel, 'hermes3:latest');
});

test('AutonomousEngine: runs a complete autonomous hunting, triage, and staging cycle', async () => {
  const engine = getAutonomousEngine({
    cycleIntervalSec: 100,
    minRewardDollars: 10,
    minExpectedValue: 5,
    autoExecuteDeliverables: true
  });

  engine.start();
  // Trigger single cycle manually
  await engine._runCycle();

  const status = engine.getStatus();
  assert.equal(status.metrics.cyclesCompleted, 1);
  assert.equal(status.metrics.opportunitiesScanned, 1);
  assert.equal(status.metrics.triagedPassed, 1);
  assert.equal(status.metrics.deliverablesStaged, 1);
  assert.ok(status.metrics.totalPotentialEvDollars > 0);

  const staged = await engine.listStagedDeliverables();
  assert.ok(staged.length >= 1);
  assert.ok(staged[0].title);
  assert.ok(staged[0].rewardDollars > 0);
});

test('AutonomousEngine: filters out opportunities below reward or EV threshold', async () => {
  const engine = getAutonomousEngine({
    minRewardDollars: 500, // Very high minimum reward filter
    minExpectedValue: 400
  });

  engine.start();
  await engine._runCycle();

  const status = engine.getStatus();
  assert.equal(status.metrics.cyclesCompleted, 1);
  assert.equal(status.metrics.opportunitiesScanned, 0); // None passed hunt filter
  assert.equal(status.metrics.triagedPassed, 0);
});

test('AutonomousEngine: stages ground truth deliverables and accurately distinguishes tested code from pending items', async () => {
  const engine = getAutonomousEngine({
    cycleIntervalSec: 100,
    minRewardDollars: 10,
    minExpectedValue: 5,
    autoExecuteDeliverables: true
  });

  engine.start();
  // Run 5 cycles to cycle through all 5 feed items
  for (let i = 0; i < 5; i++) {
    await engine._runCycle();
  }

  const staged = await engine.listStagedDeliverables();
  assert.ok(staged.length >= 5);

  const byId = new Map(staged.map(s => [s.candidateId, s.payload]));

  // bounty-algora-101 has real implementation and passing tests
  const algora101 = byId.get('bounty-algora-101');
  assert.ok(algora101);
  assert.equal(algora101.status, 'TESTED_AND_READY');
  assert.equal(algora101.testsPassed, true);
  assert.equal(algora101.patchFile, 'src/stripe-webhook-mutex.js');

  // bounty-algora-102 has real implementation and passing tests
  const algora102 = byId.get('bounty-algora-102');
  assert.ok(algora102);
  assert.equal(algora102.status, 'TESTED_AND_READY');
  assert.equal(algora102.testsPassed, true);
  assert.equal(algora102.patchFile, 'src/accessibility-calendar-tokens.js');

  // bounty-dispute-chargeback-301 has no implementation files
  const dispute301 = byId.get('bounty-dispute-chargeback-301');
  assert.ok(dispute301);
  assert.equal(dispute301.status, 'PENDING_IMPLEMENTATION');
  assert.equal(dispute301.testsPassed, false);

  // bounty-api-rate-limiter-401 has no implementation files
  const rate401 = byId.get('bounty-api-rate-limiter-401');
  assert.ok(rate401);
  assert.equal(rate401.status, 'PENDING_IMPLEMENTATION');
  assert.equal(rate401.testsPassed, false);
});

test('AutonomousEngine: enters idle state and prevents duplicate staging when all candidates are already staged', async () => {
  const engine = getAutonomousEngine({
    cycleIntervalSec: 100,
    minRewardDollars: 10,
    minExpectedValue: 5,
    autoExecuteDeliverables: true
  });

  engine.start();
  // Stage all 5 opportunities
  for (let i = 0; i < 5; i++) {
    await engine._runCycle();
  }

  const stagedCountAfter5 = engine.getStatus().metrics.deliverablesStaged;
  assert.equal(stagedCountAfter5, 5);
  const evAfter5 = engine.getStatus().metrics.totalPotentialEvDollars;

  // Running 6th cycle should find nothing new and enter idle
  await engine._runCycle();

  const statusAfter6 = engine.getStatus();
  assert.equal(statusAfter6.metrics.cyclesCompleted, 6);
  assert.equal(statusAfter6.metrics.deliverablesStaged, 5); // Did not re-stage
  assert.equal(statusAfter6.metrics.totalPotentialEvDollars, evAfter5); // Did not falsely inflate EV
  assert.ok(statusAfter6.currentActivity.includes('Sleeping'));
  assert.equal(statusAfter6.history[0].type, 'HUNT_IDLE');
});

