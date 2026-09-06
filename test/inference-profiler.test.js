import test from 'node:test';
import assert from 'node:assert/strict';
import { profileHardwareForInference } from '../packages/core/crypto/inference-profiler.js';

test('Inference Profiler: correctly identifies Apple Silicon Metal 3 suitability for io.net', () => {
  const result = profileHardwareForInference({
    chipModel: 'Apple M4',
    gpuCores: 10,
    unifiedRamGb: 16,
    metalVersion: 'Metal 3',
    os: 'darwin'
  });

  assert.equal(result.recommendedRole, 'LIGHTWEIGHT_INFERENCE_WORKER');
  assert.ok(result.eligibleNetworks.some(n => n.id === 'io_net'));
  assert.ok(result.ineligibleNetworks.some(n => n.id === 'akash'));
  assert.equal(result.hardware.estimatedBandwidthGbps, 120);
});

test('Inference Profiler: detects low-RAM machine as bandwidth-only worker', () => {
  const result = profileHardwareForInference({
    chipModel: 'Apple M1',
    gpuCores: 8,
    unifiedRamGb: 8,
    metalVersion: 'Metal 2',
    os: 'darwin'
  });

  assert.equal(result.recommendedRole, 'BANDWIDTH_WORKER_ONLY');
  assert.equal(result.eligibleNetworks.length, 0);
  assert.equal(result.ineligibleNetworks.length, 2);
});
