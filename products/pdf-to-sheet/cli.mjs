#!/usr/bin/env node
/**
 * Fulfil one extraction order.
 *   ANTHROPIC_API_KEY=... node cli.mjs invoice.pdf --want "line items: description, qty, unit_price, total" --out out.csv
 * Prints the CSV (and writes --out if given). --want is optional; omit it to
 * extract all tabular data. This is what the operator runs per Fiverr order.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { pdfToRows } from './extract.mjs';

const args = process.argv.slice(2);
const pdf = args.find((a) => !a.startsWith('--'));
const flag = (n) => { const i = args.indexOf('--' + n); return i === -1 ? null : args[i + 1]; };
if (!pdf) { console.error('usage: node cli.mjs <file.pdf> [--want "..."] [--out out.csv]'); process.exit(1); }

// A missing key or an unreadable PDF is an ordinary operator mistake, not a
// crash — print the reason plainly instead of a stack trace, because this runs
// under time pressure with a paying customer waiting.
try {
  const bytes = await readFile(pdf);
  const { rows, csv } = await pdfToRows(bytes, { instruction: flag('want') || '', model: flag('model') || undefined });
  const out = flag('out');
  if (out) { await writeFile(out, csv); console.error(`Wrote ${rows.length} rows to ${out}`); }
  else { process.stdout.write(csv); console.error(`\n(${rows.length} rows)`); }
} catch (err) {
  console.error(`\n✗ ${err.message || err}\n`);
  if (/ANTHROPIC_API_KEY/.test(String(err.message))) {
    console.error('  Fix: export ANTHROPIC_API_KEY=sk-...   then run the command again.\n');
  }
  process.exit(1);
}
