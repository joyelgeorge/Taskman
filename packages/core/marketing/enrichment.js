import { updateLead, LEAD_STATUS } from './store.js';

/**
 * Executes a waterfall enrichment strategy.
 * Iterates through the provided adapters until one returns a verified email.
 */
export async function waterfallEnrich(lead, providers = []) {
  if (!lead || !lead.id) {
    throw new Error('Valid lead record required for enrichment');
  }

  if (lead.status !== LEAD_STATUS.NEW) {
    return { status: 'SKIPPED', reason: 'Lead is not in NEW status', lead };
  }

  for (const provider of providers) {
    try {
      const result = await provider.enrich(lead);
      if (result && result.email) {
        const updatedLead = await updateLead(lead.id, {
          status: LEAD_STATUS.QUALIFIED,
          contactHint: result.email,
          rawRecord: { ...lead.rawRecord, enrichedBy: provider.name }
        });
        return { status: 'SUCCESS', email: result.email, provider: provider.name, lead: updatedLead };
      }
    } catch (error) {
      // Continue to next provider in the waterfall
      continue;
    }
  }

  const rejectedLead = await updateLead(lead.id, {
    status: LEAD_STATUS.REJECTED,
    rawRecord: { ...lead.rawRecord, enrichmentFailed: true }
  });
  
  return { status: 'FAILED', reason: 'Waterfall exhausted', lead: rejectedLead };
}
