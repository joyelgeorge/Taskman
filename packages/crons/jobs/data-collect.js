import { CRON_DEFINITIONS, runDataCollection } from '@taskman/core';

export const definition = CRON_DEFINITIONS.find(c => c.cronName === 'data-collect');

/**
 * The accumulating half of the system — see docs/DATA_ECOSYSTEM.md.
 *
 * Collects each declared source once, rolls the day into a daily aggregate,
 * then prunes raw rows past retention. The rollup is the asset; the raw rows
 * are deliberately disposable, which is what keeps this free to run forever.
 */
export async function handler({ fetchImpl } = {}) {
  return runDataCollection({ fetchImpl });
}
