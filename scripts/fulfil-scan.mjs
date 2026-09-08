#!/usr/bin/env node
/**
 * Operate the AI-app-security-scan lane. Read-only until a verified payment.
 *   node scripts/fulfil-scan.mjs prepare <repoPath> [--tier scan|fix]
 *   node scripts/fulfil-scan.mjs deliver <repoPath> --tier scan --ref <paypalTxn> --gross 9900 [--fee 400] --minutes 30
 * `prepare` scans and prints the report + payment link, booking nothing.
 * `deliver` books a settlement — only with a real PayPal reference.
 */
import { prepareScanOrder, fulfilScanOrder } from '../src/scan-fulfilment.js';

const [cmd, root] = process.argv.slice(2);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i === -1 ? d : process.argv[i + 1]; };
if (!cmd || !root) { console.error('usage: prepare|deliver <repoPath> [flags]'); process.exit(1); }

if (cmd === 'prepare') {
  const order = await prepareScanOrder({ root, tier: arg('tier', 'scan'), preparedFor: arg('for', null) });
  console.log(order.report.markdown);
  console.log(`\n--- Payment: ${order.payment.note}\n--- ${order.payment.link}`);
} else if (cmd === 'deliver') {
  const done = await fulfilScanOrder({
    root, tier: arg('tier', 'scan'), preparedFor: arg('for', null),
    source: arg('source', 'paypal'), externalRef: arg('ref'),
    grossCents: Number(arg('gross', 0)), feeCents: Number(arg('fee', 0)), minutesSpent: Number(arg('minutes', 0))
  });
  console.log(`Booked: ${done.settlement.source} ${done.settlement.externalRef}, net $${done.economics.netCents / 100}`);
  console.log(done.stream ? `Stream ${done.stream.streamKey} -> earning` : 'Pending (not cleared)');
} else { console.error('unknown command'); process.exit(1); }
