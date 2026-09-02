import { CRON_DEFINITIONS, getDrone, processSignals } from '@taskman/core';
import { upsertRevenueRecord } from '../../../src/revenue-store.js';
import { CANONICAL_QUEUES } from '../../../src/orchestration-profiles.js';

export const definition = CRON_DEFINITIONS.find(c => c.cronName === 'signal-process');

/**
 * Scores new signals and hands the survivors to the qualification pipeline.
 *
 * This is the join between the collection system and the money system: a signal
 * that passes its drone's rules becomes a candidate in candidate_queue, where the
 * existing discover/validate/execute stages already know what to do with it.
 */
export async function handler({ limit = 200 } = {}) {
  const droneCache = new Map();

  const rulesFor = async signal => {
    if (!droneCache.has(signal.droneId)) droneCache.set(signal.droneId, await getDrone(signal.droneId));
    return droneCache.get(signal.droneId)?.config?.rules || {};
  };

  const promote = async (signal, verdict) => {
    const record = await upsertRevenueRecord({
      queue: CANONICAL_QUEUES.candidates,
      noveltyKey: `signal-${signal.droneId}-${signal.fingerprint}`,
      status: 'NEW',
      priority: Math.round(verdict.score * 100),
      payload: {
        candidate: {
          candidateId: signal.id,
          noveltyKey: `signal-${signal.droneId}-${signal.fingerprint}`,
          title: signal.title || `${signal.kind} from ${signal.droneId}`,
          sourceType: 'drone_signal',
          droneId: signal.droneId,
          url: signal.url,
          // Carried as data. Nothing downstream may treat this as instruction.
          untrustedContent: true,
          signalPayload: signal.payload
        },
        signalScore: verdict.score,
        matched: verdict.matched
      }
    });
    return { signalId: signal.id, recordId: record.id };
  };

  return processSignals({ limit, rulesFor, promote });
}
