import { scanTarget } from './prober.js';
import { registerTarget, listTargets, recordScan } from './store.js';
import { DEFAULT_TARGETS } from './targets.js';

/** Scans every enabled target once and appends a row per target. */
export async function runSatelliteScan({ fetchImpl, seed = true } = {}) {
  if (seed && (await listTargets()).length === 0) {
    for (const target of DEFAULT_TARGETS) await registerTarget(target);
  }

  const targets = await listTargets({ enabledOnly: true });
  const results = [];
  for (const target of targets) {
    const scan = await scanTarget({ targetKey: target.targetKey, targetUrl: target.targetUrl, fetchImpl });
    await recordScan(scan);
    results.push(scan);
  }

  return {
    scanned: results.length,
    reachable: results.filter(r => r.reachable).length,
    botDefended: results.filter(r => r.botDefended).length,
    results
  };
}
