#!/usr/bin/env node
/**
 * `npm run scan-bundles -- --urls <file>` — the high-yield lead engine.
 *
 * Scans a list of DEPLOYED app URLs (one per line) for exposed service_role
 * keys in their client bundles, and persists the ones with a finding as leads.
 * This is the ~50x surface (research 2026-09-15): a key in a shipped bundle is
 * not in a repo, so it is not auto-revoked and there are far more of them.
 *
 * Read-only: it fetches what every browser already downloads. It never uses a
 * key and never calls a non-public endpoint.
 *
 * Get a URL list from indie-launch directories, your own list, anywhere — one
 * URL per line. Blank lines and # comments are ignored.
 */
import { readFile } from 'node:fs/promises';
import { readFlag } from '../src/cli-flags.js';
import { scanDeployedApps, toBundleLeadResult } from '../packages/core/jobs/bundle-scan.js';
import { persistLeads } from '../packages/core/targets/lead-persistence.js';
import { databaseEnabled } from '../src/db.js';
import * as store from '../packages/core/marketing/store.js';

const argv = process.argv.slice(2);
const file = readFlag(argv, 'urls');
if (!file) { console.error('usage: npm run scan-bundles -- --urls <file>  (one deployed app URL per line)'); process.exit(2); }

const urls = (await readFile(file, 'utf8'))
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  .map(u => u.startsWith('http') ? u : `https://${u}`);

if (!urls.length) { console.error('no URLs in the file'); process.exit(2); }
console.log(`scanning ${urls.length} deployed app(s) for exposed keys in their bundles…`);

const results = await scanDeployedApps(urls);
const leads = [];
for (const r of results) {
  if (!r.reachable) { console.log(`  unreachable  ${r.app}`); continue; }
  const lead = toBundleLeadResult(r);
  if (lead) {
    console.log(`  LEAD  ${r.app}  (${r.findings.length} finding, service_role in a bundle)`);
    leads.push(lead);
  } else {
    console.log(`  ok    ${r.app}`);
  }
}

console.log(`\n${leads.length} lead(s) of ${urls.length} scanned.`);

if (!leads.length) process.exit(0);
if (!databaseEnabled) {
  console.error('\nDATABASE_URL is not set — leads found but not persisted. Set it to keep them.');
  process.exit(1);
}
const summary = await persistLeads(leads, { store });
console.log(`persisted: ${summary.created} new, ${summary.updated} updated, ${summary.skipped} skipped, ${summary.failed} failed`);
console.log('\nEach still needs the business-reality check and a hand-verified finding before any outreach — see the verify-lead-before-contact skill.');
