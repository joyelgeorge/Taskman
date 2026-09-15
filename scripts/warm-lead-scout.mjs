#!/usr/bin/env node
/**
 * `npm run warm-scout` — the primary lead engine, finally runnable.
 *
 * Searches GitHub for people asking for help securing their vibe-coded app,
 * surfaces the open threads, and persists them as warm leads flagged for a human
 * to read before any reply. Public, read-only. It contacts nobody.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { warmLeadCandidates, WARM_QUERIES } from '../packages/core/marketing/warm-lead-scout.js';
import { databaseEnabled } from '../src/db.js';
import { upsertCampaign, createLead, listLeads, LEAD_SOURCE } from '../packages/core/marketing/store.js';

const run = promisify(execFile);
const CAMPAIGN = 'warm-inbound-vibe-security';

async function search(q) {
  try {
    const { stdout } = await run('gh', ['api', '-X', 'GET', 'search/issues',
      '--raw-field', `q=${q}`, '-f', 'per_page=20',
      '--jq', '.items[] | {title, html_url, state, user, created_at}'],
      { timeout: 30000, maxBuffer: 1 << 24 });
    return stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (e) {
    console.warn(`  (query failed: ${q.slice(0, 40)}… — ${String(e.message).slice(0, 50)})`);
    return [];
  }
}

const self = (process.env.GITHUB_ACTOR || '').toLowerCase() || 'joyelgeorge';
const all = [];
for (const q of WARM_QUERIES) { for (const it of await search(q)) all.push(it); }
const candidates = warmLeadCandidates(all, { self });

console.log(`${candidates.length} warm-intent thread(s) from ${WARM_QUERIES.length} queries:`);
for (const c of candidates.slice(0, 25)) console.log(`  ${c.createdAt?.slice(0,10)}  ${c.url}\n      "${c.title.slice(0, 70)}"`);

if (!candidates.length) process.exit(0);
if (!databaseEnabled) {
  console.error('\nDATABASE_URL not set — found but not persisted. Set it to keep them.');
  process.exit(1);
}

await upsertCampaign({ campaignKey: CAMPAIGN, name: 'Warm inbound — vibe-app security',
  lane: 'vibe-app-security', valueProposition: 'Reply to people asking for help securing their app' });
const existing = new Set((await listLeads({ campaignKey: CAMPAIGN }))
  .map(l => l?.rawRecord?.url).filter(Boolean));
let created = 0;
for (const c of candidates) {
  if (existing.has(c.url)) continue;
  await createLead({ campaignKey: CAMPAIGN, source: LEAD_SOURCE.DRONE, rawRecord: c, contactHint: c.url });
  created++;
}
console.log(`\npersisted: ${created} new warm lead(s). Each needs a human to read the thread before replying — see the warm-lead-scout skill.`);
