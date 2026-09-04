import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStrategicObjective,
  addStrategicDirective,
  getStrategicObjective,
  listStrategicObjectives,
  generateStrategicBrief,
  resetStrategicMemory,
  OBJECTIVE_STATUS
} from '../src/strategic-control-plane.js';

test('createStrategicObjective persists objective with budget and boundaries', async () => {
  resetStrategicMemory();
  const obj = await createStrategicObjective({
    id: 'obj-1',
    title: 'Grow ARR to $10k',
    desiredOutcome: 'Acquire 10 enterprise subscribers',
    priority: 500,
    budgetCents: 50000,
    constraints: { maxSingleActionCostCents: 5000 },
    killCriteria: ['ROI drops below 1.5x']
  });

  assert.equal(obj.id, 'obj-1');
  assert.equal(obj.status, OBJECTIVE_STATUS.ACTIVE);
  assert.equal(obj.budgetCents, 50000);
  assert.equal(obj.priority, 500);

  const retrieved = await getStrategicObjective('obj-1');
  assert.ok(retrieved);
  assert.equal(retrieved.title, 'Grow ARR to $10k');
  assert.deepEqual(retrieved.killCriteria, ['ROI drops below 1.5x']);
});

test('addStrategicDirective appends versioned guidance without erasing prior state', async () => {
  resetStrategicMemory();
  await createStrategicObjective({
    id: 'obj-2',
    title: 'Scale Fiverr Bookkeeping Wedge',
    desiredOutcome: '10 customer completions',
    priority: 300,
    constraints: { requireReceipts: true }
  });

  const d1 = await addStrategicDirective({
    objectiveId: 'obj-2',
    author: 'strategic_ai',
    directiveText: 'Focus discovery exclusively on gig reconciliation',
    rationale: 'Higher conversion velocity observed'
  });

  assert.equal(d1.version, 1);
  assert.equal(d1.author, 'strategic_ai');

  const d2 = await addStrategicDirective({
    objectiveId: 'obj-2',
    author: 'human',
    directiveText: 'Elevate priority to P0 immediately',
    updatedPriority: 1000,
    updatedConstraints: { maxHourlyClaims: 5 }
  });

  assert.equal(d2.version, 2);
  assert.equal(d2.author, 'human');

  const obj = await getStrategicObjective('obj-2');
  assert.equal(obj.priority, 1000);
  assert.equal(obj.constraints.maxHourlyClaims, 5);
  assert.equal(obj.constraints.requireReceipts, true); // Retained original constraint
});

test('generateStrategicBrief produces bounded summary with verified economics and blockers', async () => {
  resetStrategicMemory();
  await createStrategicObjective({
    id: 'obj-3',
    title: 'Autonomous Software Maintenance',
    desiredOutcome: 'Zero regression merges',
    priority: 800,
    budgetCents: 100000
  });

  const brief = await generateStrategicBrief({ objectiveId: 'obj-3' });
  assert.ok(brief.asOf);
  assert.equal(brief.activeObjectivesCount, 1);
  assert.ok(brief.totalVerifiedRevenue.startsWith('$'));
  assert.equal(brief.objectives[0].id, 'obj-3');
  assert.ok(Array.isArray(brief.recommendedActions));
});
