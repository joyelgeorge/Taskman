import { getCollector } from '../drones/index.js';
import { createLead, LEAD_SOURCE, getCampaign } from './store.js';

/**
 * Flies a drone designed to collect candidate buyers (leads) rather than signals.
 * @param {Object} drone The drone configuration object (e.g. { id, kind, url, ... })
 * @param {string} campaignKey The campaign to associate leads with.
 * @param {Object} options
 * @param {Function} options.fetchImpl Custom fetch implementation for testing.
 * @param {Function} options.qualifyFn A function(rawRecord) -> { qualified: boolean, contactHint: string } 
 *                                     to filter and extract contact info from the raw drone payload.
 */
export async function runLeadDrone(drone, campaignKey, { fetchImpl, qualifyFn } = {}) {
  const started = Date.now();
  try {
    const campaign = await getCampaign(campaignKey);
    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignKey}`);
    }

    const collector = getCollector(drone.kind);
    const { signals, meta } = await collector.collect(drone, { fetchImpl });

    let qualifiedCount = 0;
    let insertedCount = 0;

    for (const raw of signals) {
      let qualified = true;
      let contactHint = null;

      if (typeof qualifyFn === 'function') {
        const result = await qualifyFn(raw);
        if (result === false || result?.qualified === false) {
          qualified = false;
        } else if (result && typeof result === 'object') {
          contactHint = result.contactHint || null;
        }
      }

      if (qualified) {
        qualifiedCount++;
        await createLead({
          campaignKey,
          source: LEAD_SOURCE.DRONE,
          rawRecord: raw,
          contactHint
        });
        insertedCount++;
      }
    }

    return {
      droneId: drone.id,
      status: 'OK',
      seen: signals.length,
      qualified: qualifiedCount,
      inserted: insertedCount,
      latencyMs: meta?.latencyMs ?? Date.now() - started
    };
  } catch (error) {
    const message = String(error.message || error).slice(0, 500);
    return {
      droneId: drone.id,
      status: 'FAILED',
      error: message,
      latencyMs: Date.now() - started
    };
  }
}
