import { getCollector } from '../drones/index.js';
import { createLead, listLeads, LEAD_SOURCE, getCampaign } from './store.js';

/**
 * Flies a drone designed to collect candidate buyers (leads) rather than signals.
 *
 * This is a thin reuse of the existing drone infrastructure: the collector fetches
 * and parses raw signals; this adapter decides whether each signal is a lead and,
 * if so, persists it to the leads table — no seeding of fabricated lead sources.
 *
 * @param {Object}   drone           Drone config: { id, kind, targetUrl, config, ... }
 * @param {string}   campaignKey     Campaign to associate leads with (must already exist).
 * @param {Object}   options
 * @param {Function} options.fetchImpl    Custom fetch for testing.
 * @param {Function} options.qualifyFn   (rawSignal) => { qualified: boolean, contactHint?: string }
 *                                        When omitted every signal qualifies.
 */
/** A signal's natural identity: its url, or failing that its title. Mirrors the
 * dedupe key lead-persistence.js uses (rawRecord.repo) for the scan path. */
function signalKey(raw = {}) {
  return raw.url || raw.link || raw.guid || raw.title || null;
}

export async function runLeadDrone(drone, campaignKey, { fetchImpl, qualifyFn, collectorImpl } = {}) {
  const started = Date.now();
  try {
    const campaign = await getCampaign(campaignKey);
    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignKey}`);
    }

    const collector = collectorImpl || getCollector(drone.kind);
    const { signals, meta } = await collector.collect(drone, { fetchImpl });

    let qualifiedCount = 0;
    let insertedCount = 0;
    let duplicateCount = 0;

    // What this drone has already turned into a lead. Flying twice over a feed
    // that still carries the same items must not insert the same lead again.
    const existing = await listLeads({ campaignKey });
    const seen = new Set(existing.map(l => signalKey(l.rawRecord)).filter(Boolean));

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
        const key = signalKey(raw);
        if (key && seen.has(key)) {
          duplicateCount++;
          continue;
        }
        await createLead({
          campaignKey,
          source: LEAD_SOURCE.DRONE,
          rawRecord: raw,
          contactHint
        });
        if (key) seen.add(key);   // also dedupe within a single flight
        insertedCount++;
      }
    }

    return {
      droneId: drone.id,
      status: 'OK',
      seen: signals.length,
      qualified: qualifiedCount,
      inserted: insertedCount,
      duplicates: duplicateCount,
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
