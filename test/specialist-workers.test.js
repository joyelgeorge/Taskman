import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerSpecialistWorker,
  getSpecialistWorker,
  listSpecialistWorkers,
  benchmarkSpecialistWorker,
  executeWithSpecialistOrFallback,
  resetSpecialistRegistry
} from '../src/specialist-workers.js';

test('registerSpecialistWorker enforces required properties and registers specialist', () => {
  resetSpecialistRegistry();
  assert.throws(() => registerSpecialistWorker({ id: 'bad' }), /supportedTaskClasses/);

  const worker = registerSpecialistWorker({
    id: 'local-regex-extractor',
    name: 'Local RegEx/Regex Utility Worker',
    supportedTaskClasses: ['extraction', 'candidate_classification'],
    dataPolicy: 'local_only',
    costPerCallCents: 0
  });

  assert.equal(worker.id, 'local-regex-extractor');
  assert.equal(worker.status, 'probation');
  assert.equal(worker.qualityScore, 0.0);
  assert.equal(getSpecialistWorker('local-regex-extractor').id, 'local-regex-extractor');
});

test('benchmarkSpecialistWorker promotes qualified workers and disables underperforming ones', async () => {
  resetSpecialistRegistry();
  
  const goodWorker = registerSpecialistWorker({
    id: 'good-extractor',
    supportedTaskClasses: ['extraction'],
    execute: async (input) => ({ field: input.raw.trim().toUpperCase() })
  });

  const fixtures = [
    { input: { raw: 'abc' }, expectedOutput: { field: 'ABC' } },
    { input: { raw: 'xyz' }, expectedOutput: { field: 'XYZ' } }
  ];

  const res = await benchmarkSpecialistWorker({
    specialistId: 'good-extractor',
    testFixtures: fixtures,
    minPassRate: 0.8
  });

  assert.equal(res.status, 'active');
  assert.equal(res.passRate, 1.0);
  assert.equal(goodWorker.status, 'active');

  // Now test underperforming worker
  const failingWorker = registerSpecialistWorker({
    id: 'failing-extractor',
    supportedTaskClasses: ['extraction'],
    execute: async () => ({ field: 'wrong' })
  });

  const failRes = await benchmarkSpecialistWorker({
    specialistId: 'failing-extractor',
    testFixtures: fixtures,
    minPassRate: 0.8
  });

  assert.equal(failRes.status, 'disabled');
  assert.equal(failingWorker.status, 'disabled');
});

test('executeWithSpecialistOrFallback routes to qualified specialist or fails closed to fallback', async () => {
  resetSpecialistRegistry();

  // Register and promote good worker
  registerSpecialistWorker({
    id: 'active-extractor',
    status: 'active',
    supportedTaskClasses: ['structured_extraction'],
    execute: async (input) => ({ amount: Number(input.text.match(/\d+/)[0]) })
  });

  // 1. Success case using specialist
  const result1 = await executeWithSpecialistOrFallback({
    taskClass: 'structured_extraction',
    taskInput: { text: 'Total: $450' },
    validateOutput: (out) => typeof out.amount === 'number' && out.amount > 0,
    fallbackExecutor: async () => ({ amount: 999 })
  });
  assert.equal(result1.source, 'specialist');
  assert.equal(result1.output.amount, 450);

  // 2. Validation failure -> fail closed to fallback
  const result2 = await executeWithSpecialistOrFallback({
    taskClass: 'structured_extraction',
    taskInput: { text: 'No numbers here' }, // match will throw / fail
    validateOutput: (out) => typeof out.amount === 'number' && out.amount > 0,
    fallbackExecutor: async () => ({ amount: 999 })
  });
  assert.equal(result2.source, 'fallback');
  assert.equal(result2.output.amount, 999);

  // 3. Undeclared task class -> route to fallback
  const result3 = await executeWithSpecialistOrFallback({
    taskClass: 'deep_reasoning',
    taskInput: { text: 'Why is the sky blue?' },
    fallbackExecutor: async () => ({ answer: 'Rayleigh scattering' })
  });
  assert.equal(result3.source, 'fallback');
  assert.equal(result3.output.answer, 'Rayleigh scattering');
});
