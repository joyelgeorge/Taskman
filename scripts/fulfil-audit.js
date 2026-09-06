#!/usr/bin/env node
/**
 * Deliver one paid audit and book it.
 *
 *   npm run fulfil -- --platform earnings.csv --bank bank.csv \
 *     --ref pi_3Ox... --gross 2000 --fee 88 --minutes 12 --for "Acme" --out report.html
 *
 * One command because the first sale should not require assembling anything: the
 * report is written, the settlement is recorded against its payment reference,
 * and the stream moves to EARNING off that settlement rather than off anyone's
 * say-so.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fulfilAuditOrder } from '../src/audit-fulfilment.js';
import { pool } from '../src/db.js';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

const usd = cents => `$${(cents / 100).toFixed(2)}`;

async function main() {
  const a = args(process.argv.slice(2));
  const missing = ['platform', 'bank', 'ref', 'gross', 'minutes'].filter(k => !a[k]);
  if (missing.length) {
    console.error(`Missing: ${missing.map(m => `--${m}`).join(' ')}\n\n`
      + 'Usage: npm run fulfil -- --platform <csv> --bank <csv> --ref <payment-ref> \\\n'
      + '         --gross <cents> [--fee <cents>] --minutes <n> [--for <name>] \\\n'
      + '         [--source stripe|bank|manual_receipt] [--out report.html]');
    return 1;
  }

  const result = await fulfilAuditOrder({
    platformCsv: await readFile(a.platform, 'utf8'),
    bankCsv: await readFile(a.bank, 'utf8'),
    preparedFor: a.for || null,
    source: a.source || 'stripe',
    externalRef: a.ref,
    grossCents: Number(a.gross),
    feeCents: Number(a.fee || 0),
    minutesSpent: Number(a.minutes)
  });

  const out = a.out || 'report.html';
  await writeFile(out, result.html);

  console.log(`Report written to ${out}`);
  console.log(`  ${result.report.actions[0]}`);
  console.log(`Settlement ${result.settlement.status} ${usd(result.settlement.netCents)} net `
    + `(ref ${result.settlement.externalRef})`);
  console.log(`Stream ${result.stream ? result.stream.state : 'unchanged — payment has not cleared'}`);
  console.log(`Effective rate ${result.economics.effectiveHourlyRate == null
    ? 'unknown' : `$${result.economics.effectiveHourlyRate}/h`} on ${result.economics.minutesSpent} minutes`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(async code => { if (pool) await pool.end(); process.exit(code); })
    .catch(async error => { console.error(String(error.message || error)); if (pool) await pool.end(); process.exit(1); });
}
