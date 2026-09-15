#!/usr/bin/env node
/**
 * `npm run self-serve -- --url <deployed-app-url> [--paid]`
 *
 * The self-serve product's engine, runnable now: scan a deployed app's public
 * bundles and print the FREE report (counts) or, with --paid, the full report
 * with the exact fixes. This is what a public scan endpoint calls; running it
 * here proves the whole pipeline end to end before any frontend or checkout.
 *
 * Read-only: fetches only what a browser downloads. Contacts nobody.
 */
import { readFlag } from '../src/cli-flags.js';
import { scanDeployedApp } from '../packages/core/jobs/bundle-scan.js';
import { freeReport, paidReport } from '../packages/core/self-serve/report.js';

const argv = process.argv.slice(2);
const url = readFlag(argv, 'url');
const paid = argv.includes('--paid');
if (!url) { console.error('usage: npm run self-serve -- --url <deployed-app-url> [--paid]'); process.exit(2); }

const scan = await scanDeployedApp(url.startsWith('http') ? url : `https://${url}`);
if (!scan.reachable) { console.error(`could not reach ${url}: ${scan.reason}`); process.exit(1); }

const report = paid ? paidReport({ app: scan.app, findings: scan.findings })
                    : freeReport({ app: scan.app, findings: scan.findings });

if (!paid) {
  console.log(`\nScan of ${report.app}`);
  console.log(`${report.total} issue(s):`, report.byKind);
  console.log(report.message);
  console.log('\n(run with --paid to see the fixes — this is what the customer unlocks)');
} else {
  console.log(`\nFull report for ${report.app} — ${report.total} issue(s)\n`);
  for (const f of report.fixes) {
    console.log(`■ ${f.kind}${f.where ? '  ('+f.where+')' : ''}`);
    console.log(`  ${f.title}`);
    for (const s of f.steps) console.log(`    - ${s}`);
    console.log();
  }
}
