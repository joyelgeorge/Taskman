/**
 * Decentralized Compute Profiler & Worker Evaluator
 * Evaluates hardware suitability (Metal 3 / CUDA / RAM) for decentralized AI inference networks (io.net / Akash / Render).
 */

export const INFERENCE_NETWORK_PROFILES = Object.freeze({
  IO_NET: {
    id: 'io_net',
    name: 'io.net Cloud',
    minRamGb: 16,
    metalSupported: true,
    targetModels: ['llama-3.2-3b', 'mistral-7b', 'phi-3-mini'],
    estMonthlyRateUsd: { min: 15, max: 45 }
  },
  AKASH: {
    id: 'akash',
    name: 'Akash Network',
    minRamGb: 16,
    metalSupported: false, // Akash compute nodes are predominantly Linux x86/CUDA
    targetModels: ['qwen-2.5-7b', 'deepseek-r1-distill-8b'],
    estMonthlyRateUsd: { min: 20, max: 60 }
  }
});

export function profileHardwareForInference({
  chipModel = 'Apple M4',
  gpuCores = 10,
  unifiedRamGb = 16,
  metalVersion = 'Metal 3',
  os = 'darwin'
} = {}) {
  const isAppleSilicon = os === 'darwin' && chipModel.includes('Apple');
  const eligibleNetworks = [];
  const ineligibleNetworks = [];

  for (const [, net] of Object.entries(INFERENCE_NETWORK_PROFILES)) {
    if (unifiedRamGb < net.minRamGb) {
      ineligibleNetworks.push({ id: net.id, name: net.name, reason: 'Insufficient RAM (requires ' + net.minRamGb + 'GB)' });
      continue;
    }

    if (isAppleSilicon && !net.metalSupported) {
      ineligibleNetworks.push({ id: net.id, name: net.name, reason: 'Requires Linux x86 + NVIDIA CUDA environment' });
      continue;
    }

    eligibleNetworks.push({
      id: net.id,
      name: net.name,
      supportedModels: net.targetModels,
      estMonthlyYieldUsd: net.estMonthlyRateUsd
    });
  }

  // Calculate memory bandwidth estimate: Apple M4 base has ~120 GB/s bandwidth
  const estimatedBandwidthGbps = chipModel.includes('M4 Pro') ? 273 : (chipModel.includes('M4 Max') ? 546 : 120);
  const maxModelParameterSizeBillion = Math.floor(unifiedRamGb * 0.65 / 2); // 4-bit / 8-bit quantized fit within ~10GB VRAM headroom

  return {
    hardware: {
      chipModel,
      gpuCores,
      unifiedRamGb,
      metalVersion,
      estimatedBandwidthGbps,
      maxModelParameterSizeBillion
    },
    eligibleNetworks,
    ineligibleNetworks,
    recommendedRole: eligibleNetworks.length > 0 ? 'LIGHTWEIGHT_INFERENCE_WORKER' : 'BANDWIDTH_WORKER_ONLY'
  };
}
