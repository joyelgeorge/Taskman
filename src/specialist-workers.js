import { databaseEnabled, query } from './db.js';

// In-memory registry for specialist models
const specialistRegistry = new Map();
const benchmarkResultsMemory = new Map();

/**
 * Specialist Model Definition schema:
 * - id: string (e.g. 'local-llama-8b-extractor', 'ollama-qwen-coder')
 * - name: string
 * - type: 'local' | 'specialized_api' | 'self_hosted'
 * - supportedTaskClasses: string[] (e.g. ['extraction', 'candidate_classification'])
 * - contextLimitTokens: number
 * - latencyProfileMs: number
 * - costPerCallCents: number (usually 0 for local)
 * - hardwareRequirement: string (e.g. 'none', 'apple_silicon_8gb', 'cuda_16gb')
 * - dataPolicy: 'local_only' | 'no_retention' | 'general'
 * - benchmarkVersion: string
 * - qualityScore: number (0.0 to 1.0)
 * - status: 'active' | 'probation' | 'disabled'
 * - execute: async (task) => output
 */

export function registerSpecialistWorker(spec) {
  if (!spec.id || !spec.supportedTaskClasses || !spec.supportedTaskClasses.length) {
    throw new Error('Specialist worker must have an id and declared supportedTaskClasses');
  }

  const record = {
    id: spec.id,
    name: spec.name || spec.id,
    type: spec.type || 'local',
    supportedTaskClasses: [...spec.supportedTaskClasses],
    contextLimitTokens: spec.contextLimitTokens || 4096,
    latencyProfileMs: spec.latencyProfileMs || 250,
    costPerCallCents: spec.costPerCallCents !== undefined ? spec.costPerCallCents : 0,
    hardwareRequirement: spec.hardwareRequirement || 'none',
    dataPolicy: spec.dataPolicy || 'local_only',
    benchmarkVersion: spec.benchmarkVersion || 'v1.0',
    qualityScore: spec.qualityScore !== undefined ? spec.qualityScore : 0.0,
    status: spec.status || 'probation',
    execute: spec.execute || null
  };

  specialistRegistry.set(record.id, record);
  return record;
}

export function getSpecialistWorker(id) {
  return specialistRegistry.get(id) || null;
}

export function listSpecialistWorkers({ taskClass = null, minQuality = 0.0, activeOnly = true } = {}) {
  let workers = Array.from(specialistRegistry.values());
  if (taskClass) {
    workers = workers.filter(w => w.supportedTaskClasses.includes(taskClass));
  }
  if (activeOnly) {
    workers = workers.filter(w => w.status === 'active');
  }
  if (minQuality > 0) {
    workers = workers.filter(w => w.qualityScore >= minQuality);
  }
  return workers;
}

/**
 * Runs a benchmark suite against a specialist and updates its quality score.
 * If quality drops below threshold (e.g. 0.85), marks specialist as 'disabled' or 'probation'.
 */
export async function benchmarkSpecialistWorker({
  specialistId,
  testFixtures = [], // array of { input, expectedOutput, validator: (output, expected) => boolean }
  minPassRate = 0.85
}) {
  const specialist = getSpecialistWorker(specialistId);
  if (!specialist) {
    throw new Error(`Specialist ${specialistId} not registered`);
  }
  if (!specialist.execute) {
    throw new Error(`Specialist ${specialistId} has no execution function configured`);
  }

  let passed = 0;
  let totalLatency = 0;
  const fixtureResults = [];

  for (const fix of testFixtures) {
    const start = Date.now();
    try {
      const output = await specialist.execute(fix.input);
      const latency = Date.now() - start;
      totalLatency += latency;

      let isSuccess = false;
      if (typeof fix.validator === 'function') {
        isSuccess = Boolean(fix.validator(output, fix.expectedOutput));
      } else {
        isSuccess = JSON.stringify(output) === JSON.stringify(fix.expectedOutput);
      }

      if (isSuccess) passed++;
      fixtureResults.push({ success: isSuccess, latencyMs: latency });
    } catch (err) {
      fixtureResults.push({ success: false, error: err.message, latencyMs: Date.now() - start });
    }
  }

  const passRate = testFixtures.length > 0 ? passed / testFixtures.length : 0;
  const avgLatency = testFixtures.length > 0 ? totalLatency / testFixtures.length : 0;

  specialist.qualityScore = Math.round(passRate * 100) / 100;
  specialist.latencyProfileMs = Math.round(avgLatency);

  if (passRate >= minPassRate) {
    specialist.status = 'active';
  } else {
    specialist.status = 'disabled'; // automatic downgrade/removal on benchmark failure
  }

  const benchmarkRecord = {
    specialistId,
    timestamp: new Date().toISOString(),
    passRate,
    passed,
    total: testFixtures.length,
    status: specialist.status,
    avgLatencyMs: specialist.latencyProfileMs
  };

  benchmarkResultsMemory.set(specialistId, benchmarkRecord);
  return benchmarkRecord;
}

/**
 * Executes a task using a qualified specialist worker, failing closed to fallback model tier if:
 * 1. No qualified specialist is registered for the taskClass.
 * 2. Specialist status is not 'active'.
 * 3. Execution errors or output fails deterministic schema validation.
 * 4. Input requires privacy policies incompatible with specialist.
 */
export async function executeWithSpecialistOrFallback({
  taskClass,
  taskInput,
  validateOutput = null, // (output) => boolean
  fallbackExecutor, // async () => fallback output
  requiresPrivacy = false
}) {
  const eligible = listSpecialistWorkers({ taskClass, activeOnly: true });

  // Filter privacy if requested
  const candidate = eligible.find(w => {
    if (requiresPrivacy && w.dataPolicy !== 'local_only') return false;
    return true;
  });

  if (!candidate || !candidate.execute) {
    // Failover directly to standard fallback executor
    const fallbackOutput = await fallbackExecutor();
    return {
      source: 'fallback',
      specialistId: null,
      output: fallbackOutput,
      reason: candidate ? 'Specialist lacks executor' : 'No active eligible specialist for taskClass'
    };
  }

  try {
    const result = await candidate.execute(taskInput);
    if (validateOutput && !validateOutput(result)) {
      // Deterministic validation failed -> fail closed to fallback
      const fallbackOutput = await fallbackExecutor();
      return {
        source: 'fallback',
        specialistId: candidate.id,
        output: fallbackOutput,
        reason: 'Specialist output failed deterministic schema validation'
      };
    }

    return {
      source: 'specialist',
      specialistId: candidate.id,
      output: result,
      costCents: candidate.costPerCallCents,
      latencyMs: candidate.latencyProfileMs
    };
  } catch (err) {
    // Execution failed -> fail closed to fallback
    const fallbackOutput = await fallbackExecutor();
    return {
      source: 'fallback',
      specialistId: candidate.id,
      output: fallbackOutput,
      reason: `Specialist execution failed: ${err.message}`
    };
  }
}

export function resetSpecialistRegistry() {
  specialistRegistry.clear();
  benchmarkResultsMemory.clear();
}
