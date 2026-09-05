import { CRON_DEFINITIONS, researchImprovements, railEconomics, incomeReport } from '@taskman/core';

export const definition = CRON_DEFINITIONS.find(c => c.cronName === 'improve');

/**
 * Reads the system's own evidence and files improvement proposals.
 *
 * Proposals are inert records. Nothing here edits code, config or schedules —
 * applying a change requires a human moving the row to ACCEPTED.
 *
 * It also reports the income portfolio on every run, because the failure this
 * system keeps repeating is working hard inside one lane while no lane earns.
 * Carrying every hypothesis — including the disproven ones and the ones blocked
 * on a person — makes "which of these could pay, and what is the cheapest next
 * test" a standing question rather than something reconsidered after months.
 */
export async function handler({ now = new Date() } = {}) {
  const improvements = await researchImprovements({ railEconomics, now });
  const income = await incomeReport({ now });
  return {
    ...improvements,
    income: {
      verdict: income.verdict,
      anySettled: income.anySettled,
      earning: income.earning,
      disproven: income.disproven,
      nextAction: income.nextAction,
      waitingOnHuman: income.waitingOnHuman.map(s => ({ streamKey: s.streamKey, nextAction: s.nextAction })),
      dataProducts: income.dataProducts
    }
  };
}
