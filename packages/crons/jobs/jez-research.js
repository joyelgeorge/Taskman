import { CRON_DEFINITIONS } from '@taskman/core';
import { executeJezResearch } from '../../../src/jez-researcher.js';

export const definition = CRON_DEFINITIONS.find(c => c.cronName === 'jez-research');

/**
 * Autonomous empirical research pass via Jez AI Gateway.
 *
 * Directs an empirical intelligence inquiry against the Jez gateway on rotating
 * lanes (vibe app security, Tally SME leakage, supply chain, autonomous revenue).
 *
 * The exchange is securely encrypted and stored in Neon `jez_exchanges` by Jez,
 * recorded in `research_notes` in Neon, and the Jez corpus distillation is updated.
 */
export async function handler({ fetchImpl, lane, trainAfter = true } = {}) {
  const result = await executeJezResearch({
    lane,
    fetchImpl,
    trainAfter
  });

  return {
    lane: result.lane,
    claim: result.claim,
    source: result.source,
    noteId: result.noteId,
    model: result.model
  };
}
