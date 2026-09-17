#!/usr/bin/env node
/**
 * Standalone CLI runner for Tally SME leakage audits.
 *
 *   npm run tally -- <path-to-export.csv> [--window=5] [--client="Retailer Name"] [--save]
 *   npm run tally -- <path-to-export.csv> --approve=operator:joyel [--save]
 *   npm run tally -- <path-to-export.csv> --verify=UPI-12345678 --amount=15000
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tallyLeakageJob } from '../packages/core/jobs/tally-leakage.js';
import { runJob } from '../packages/core/jobs/runner.js';
import { databaseEnabled } from '../src/db.js';

const argv = process.argv.slice(2);
const flag = (n) => {
  const withEq = argv.find(a => a.startsWith(`--${n}=`));
  if (withEq) return withEq.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : argv[i + 1];
};
const hasFlag = (n) => argv.some(a => a === `--${n}` || a.startsWith(`--${n}=`));

const filePath = argv.find(a => !a.startsWith('--'));
if (!filePath) {
  console.log(`usage:
  npm run tally -- <path-to-export.csv> [options]

options:
  --window=<days>          Window in days for matching vendor + amount (default 5)
  --client=<name>          Client/store name (default "Retailer")
  --approve=<operator:id>  Operator approval token for draft generation
  --verify=<ref>           Payment/recovery reference from client to trigger settlement
  --amount=<inr>           Confirmed recovered amount in INR
  --save                   Save markdown audit report to docs/outreach/
`);
  process.exit(0);
}

const windowDays = parseInt(flag('window') || '5', 10);
const clientName = flag('client') || 'Retailer';
const approval = flag('approve');
const verifyRef = flag('verify');
const confirmedAmount = parseFloat(flag('amount') || '0');
const shouldSave = hasFlag('save') || Boolean(approval);

let content = '';
try {
  content = await readFile(resolve(filePath), 'utf8');
} catch (e) {
  console.error(`error: could not read file "${filePath}": ${e.message}`);
  process.exit(1);
}

const job = tallyLeakageJob({
  load: async () => content,
  windowDays,
  clientName,
  write: shouldSave ? async (p, text) => {
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, text);
    console.log(`\nAudit report written to: ${p}`);
  } : null,
  verifyRecovery: verifyRef ? async () => ({
    source: 'manual_receipt',
    externalRef: verifyRef,
    amountInr: confirmedAmount > 0 ? confirmedAmount : 0
  }) : null
});

console.log(`\nRunning Tally SME Leakage Audit for "${clientName}"...`);
console.log(`Input: ${filePath} (${content.split('\n').length} lines)\n`);

const result = await runJob(job, { approval });

for (const r of result.runs) {
  console.log(`${r.stage.padEnd(12)} ${r.outcome.padEnd(9)} ${r.reason || ''}`);
  if (r.stage === 'detect' && r.result) {
    console.log(`  Records scanned:      ${r.result.rowCount}`);
    console.log(`  Duplicate items:      ${r.result.duplicateFlags.length}`);
    console.log(`  Stock discrepancies:  ${r.result.stockFlags.length}`);
    console.log(`  Total Recoverable:    ₹${r.result.totalRecoverableInr.toLocaleString('en-IN')}`);
    console.log(`  Contingency Fee (20%):₹${r.result.contingencyFeeInr.toLocaleString('en-IN')}`);
  }
}

if (!approval && !result.charged) {
  console.log('\n[Note] Re-run with --approve=operator:<name> to generate and save formal client audit report.');
}

if (result.charged) {
  console.log(`\n✓ Settlement successfully recorded for ${clientName}!`);
}

process.exit(result.charged || !result.stopped ? 0 : 0);
