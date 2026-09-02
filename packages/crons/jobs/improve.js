import { CRON_DEFINITIONS, researchImprovements, railEconomics } from '@taskman/core';

export const definition = CRON_DEFINITIONS.find(c => c.cronName === 'improve');

/**
 * Reads the system's own evidence and files improvement proposals.
 *
 * Proposals are inert records. Nothing here edits code, config or schedules —
 * applying a change requires a human moving the row to ACCEPTED.
 */
export async function handler({ now = new Date() } = {}) {
  return researchImprovements({ railEconomics, now });
}
