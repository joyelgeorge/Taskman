import { getCollector } from './index.js';
import { dueDrones, recordDroneRun } from './store.js';
import { insertSignals } from '../signals/store.js';

/** Flies one drone: collect, ingest, record. Never throws — failure is an outcome. */
export async function runDrone(drone, { fetchImpl } = {}) {
  const started = Date.now();
  try {
    const collector = getCollector(drone.kind);
    const { signals, meta } = await collector.collect(drone, { fetchImpl });
    const ingest = await insertSignals(drone.id, signals);

    await recordDroneRun({
      droneId: drone.id,
      status: 'OK',
      signalsSeen: signals.length,
      signalsNew: ingest.inserted,
      latencyMs: meta?.latencyMs ?? Date.now() - started
    });

    return {
      droneId: drone.id, status: 'OK',
      seen: signals.length, new: ingest.inserted,
      duplicates: ingest.duplicates, quarantined: ingest.quarantined,
      latencyMs: meta?.latencyMs ?? Date.now() - started
    };
  } catch (error) {
    const message = String(error.message || error).slice(0, 500);
    await recordDroneRun({ droneId: drone.id, status: 'FAILED', latencyMs: Date.now() - started, error: message });
    return { droneId: drone.id, status: 'FAILED', error: message, latencyMs: Date.now() - started };
  }
}

/** Flies every drone whose interval has elapsed. */
export async function dispatchDrones({ limit = 25, fetchImpl, now = new Date() } = {}) {
  const drones = await dueDrones({ now, limit });
  const results = [];
  for (const drone of drones) {
    results.push(await runDrone(drone, { fetchImpl }));
  }
  return {
    dispatched: drones.length,
    ok: results.filter(r => r.status === 'OK').length,
    failed: results.filter(r => r.status === 'FAILED').length,
    newSignals: results.reduce((sum, r) => sum + (r.new || 0), 0),
    quarantined: results.reduce((sum, r) => sum + (r.quarantined || 0), 0),
    results
  };
}
