import { CRON_DEFINITIONS, runSatelliteScan } from '@taskman/core';

export const definition = CRON_DEFINITIONS.find(c => c.cronName === 'satellite-scan');

/**
 * Runs the exact reconnaissance done by hand against Upwork, Fiverr, and
 * California's unclaimed-property registry — now on every registered target,
 * on a schedule, so a venue's shape or bot-defense posture changing over time
 * shows up as a new row instead of requiring someone to look again by hand.
 */
export async function handler({ fetchImpl } = {}) {
  return runSatelliteScan({ fetchImpl });
}
