#!/usr/bin/env node
/**
 * `npm run job` — run a revenue job's stages under the runner's four gates.
 *
 *   npm run job -- list
 *   npm run job -- run vibe-app-security --repos owner/a,owner/b [--approve operator:<name>]
 *
 * Without --approve the run stops at intervene, which is the point: the machine
 * prepares and a person decides. Every stage, refusals included, lands in
 * job_runs.
 */
import { readFlag } from '../src/cli-flags.js';
import { EXPLORED_TERRITORIES, VERDICT } from '../packages/core/territory/registry.js';
import { isRunnableJob } from '../packages/core/jobs/job-spec.js';
import { runJob } from '../packages/core/jobs/runner.js';
import { vibeAppSecurityJob } from '../packages/core/jobs/vibe-app-security.js';
import { scanRepo } from '../packages/core/jobs/vibe-app-security-default.js';
import { tallyLeakageJob } from '../packages/core/jobs/tally-leakage.js';
import { databaseEnabled } from '../src/db.js';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };

if (argv[0] === 'list' || !argv[0]) {
  for (const t of EXPLORED_TERRITORIES) {
    const mark = isRunnableJob(t) ? 'RUNNABLE' : '        ';
    console.log(`${mark}  ${String(t.verdict).padEnd(9)} ${t.key.padEnd(34)} ${t.distribution || '-'}`);
  }
  console.log('\nRUNNABLE jobs have stages the runner can execute. The rest are notes.');
  process.exit(0);
}

if (argv[0] !== 'run') { console.error('usage: npm run job -- <list|run>'); process.exit(2); }

const key = argv[1];
if (key !== 'vibe-app-security' && key !== 'tally-smb-leakage-audit') {
  console.error(`"${key}" has no wired stages yet. \`npm run job -- list\` shows what does.`);
  process.exit(2);
}

const approval = flag('approve');
if (!databaseEnabled) {
  console.error('DATABASE_URL is not set, so no attempt will be recorded. A run nothing');
  console.error('counted is the failure job_runs exists to end. Refusing.');
  process.exit(1);
}

let job = null;

if (key === 'vibe-app-security') {
  const repos = (flag('repos') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!repos.length) { console.error('--repos owner/name[,owner/name] is required'); process.exit(2); }
  job = vibeAppSecurityJob({
    scan: async () => Promise.all(repos.map(r => scanRepo(r))),
    write: async (p, text) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, text); }
  });
} else if (key === 'tally-smb-leakage-audit') {
  const file = flag('file');
  if (!file) { console.error('--file <path-to-export.csv> is required'); process.exit(2); }
  const client = flag('client') || 'Retailer';
  const content = await readFile(resolve(file), 'utf8');
  job = tallyLeakageJob({
    load: async () => content,
    clientName: client,
    write: async (p, text) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, text); }
  });
}

const result = await runJob(job, { approval });
for (const r of result.runs) {
  console.log(`${r.stage.padEnd(10)} ${r.outcome.padEnd(8)} ${r.reason || ''}`);
}
if (!approval) {
  console.log('\nStopped at intervene: no operator approval token. Re-run with');
  console.log('--approve operator:<name> once you intend to produce drafts.');
}
console.log(`\ncharged: ${result.charged}`);
process.exit(result.charged || !result.stopped ? 0 : 1);
