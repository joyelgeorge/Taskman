#!/usr/bin/env node
/**
 * Turns the GHSA advisory dump (data/target-map/npm-our-classes.tsv) into a
 * ranked hunting map. Read-only. Each line: cwes<TAB>package<TAB>severity<TAB>ghsa.
 *
 * Ranking is by credential value (repeat-offender x severity), because the data
 * shows npm disclosure of these classes is essentially unpaid — see
 * paid-target-map.js. Company-backed packages are flagged separately as the
 * only ones worth a per-program payment check.
 */
import { readFileSync } from 'node:fs';
import { credentialScore } from '../packages/core/targets/paid-target-map.js';

const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
// Packages published under a company/product org — the only population where a
// paid bug-bounty program plausibly exists (worth a per-program check).
const COMPANY_BACKED = /^(@budibase\/|ghost$|nocodb$|n8n$|n8n-|sillytavern$|@?strapi|directus|appsmith|@?medusa|posthog)/i;

const rows = readFileSync(new URL('../data/target-map/npm-our-classes.tsv', import.meta.url), 'utf8')
  .trim().split('\n').filter(Boolean).map((l) => { const [cwes, pkg, sev] = l.split('\t'); return { cwes, pkg, sev }; });

const byPkg = new Map();
for (const r of rows) {
  const e = byPkg.get(r.pkg) || { pkg: r.pkg, count: 0, worstSev: 'low', classes: new Set() };
  e.count++; r.cwes.split(',').forEach((c) => e.classes.add(c));
  if ((SEV_RANK[r.sev] || 0) > (SEV_RANK[e.worstSev] || 0)) e.worstSev = r.sev;
  byPkg.set(r.pkg, e);
}

const ranked = [...byPkg.values()].map((e) => ({
  ...e,
  credential: credentialScore({ severity: e.worstSev, ageDays: 60, sameClassCount: e.count }),
  companyBacked: COMPANY_BACKED.test(e.pkg)
})).sort((a, b) => b.credential - a.credential || b.count - a.count);

console.log(`npm packages with CWE-22/78/918 history: ${byPkg.size} (from ${rows.length} advisories)\n`);
console.log('MIGHT PAY — company-backed, worth a per-program check:');
for (const e of ranked.filter((e) => e.companyBacked)) console.log(`  $${''}  ${e.pkg.padEnd(24)} ${e.count}x  worst=${e.worstSev}`);
console.log('\nCREDENTIAL TARGETS — repeat offenders, unpaid CVEs + scan-service proof (top 15):');
for (const e of ranked.filter((e) => !e.companyBacked).slice(0, 15))
  console.log(`  ${String(e.credential).padEnd(5)} ${e.pkg.padEnd(28)} ${e.count}x  worst=${e.worstSev}  [${[...e.classes].filter(c=>/22|78|918/.test(c)).join(',')}]`);
