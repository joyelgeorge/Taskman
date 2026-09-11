/**
 * Persist what the vibe-coded-app sweep finds, so the search compounds.
 *
 * Before this existed, scripts/hunt-vibe-leads.mjs wrote its results to
 * /tmp/vibe-leads.json. On a GitHub Actions runner that path dies with the job,
 * so every Monday the sweep found leads and threw them away: week two had no
 * idea what week one found, and nothing could be asked of the history because
 * there was no history. The leads table, the store and the scanner all already
 * existed - only this joint was missing.
 *
 * Nothing here decides to contact anyone. Leads land as NEW, and CLAUDE.md's
 * disclosure-first rule still puts a human between a finding and a message.
 */

import { toLeadRecord, LEAD_CAMPAIGN_KEY } from './lead-record.js';

export const VIBE_CAMPAIGN = Object.freeze({
  campaignKey: LEAD_CAMPAIGN_KEY,
  name: 'Vibe-coded app security',
  lane: 'vibe-coded-app-security',
  valueProposition:
    'Find and fix the exposed keys and missing row-level security in apps built with '
    + 'Lovable, Bolt, v0, Cursor and Replit on Supabase or Firebase.'
});

/**
 * @param results scan results from the sweep
 * @param store   the marketing store (injected so this is testable without a DB)
 * @returns { created, updated, skipped, failed, errors }
 */
export async function persistLeads(results = [], { store, now } = {}) {
  if (!store) throw new Error('a store is required');

  const summary = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  const records = [];
  for (const result of results) {
    const record = toLeadRecord(result, now ? { now } : undefined);
    if (!record) { summary.skipped++; continue; }
    records.push(record);
  }
  if (!records.length) return summary;

  // The leads table has a foreign key to campaigns, so the campaign must exist
  // before the first lead referencing it.
  await store.upsertCampaign({ ...VIBE_CAMPAIGN });

  const existing = await store.listLeads({ campaignKey: LEAD_CAMPAIGN_KEY });
  const byRepo = new Map(
    existing.filter(l => l?.rawRecord?.repo).map(l => [l.rawRecord.repo, l])
  );

  for (const record of records) {
    // One lead's storage failure must not discard the others - a sweep is
    // expensive and partial results are still worth keeping.
    try {
      const previous = byRepo.get(record.repo);
      if (previous) {
        await store.updateLead(previous.id, { rawRecord: record });
        summary.updated++;
      } else {
        const created = await store.createLead({
          campaignKey: LEAD_CAMPAIGN_KEY,
          source: 'drone',
          status: 'NEW',
          rawRecord: record,
          contactHint: record.homepage || `https://github.com/${record.repo}`
        });
        byRepo.set(record.repo, created);
        summary.created++;
      }
    } catch (error) {
      summary.failed++;
      summary.errors.push({ repo: record.repo, message: String(error?.message || error) });
    }
  }

  return summary;
}
