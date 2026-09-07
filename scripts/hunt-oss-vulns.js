#!/usr/bin/env node
/**
 * Clones the in-scope Node.js targets (shallow, public source), runs the
 * codebase scanner over each, and prints security candidates worth a human PoC.
 *
 * Read-only and side-effect-free beyond a shallow clone into a temp dir it
 * cleans up. Submits nothing. Every candidate it prints still needs the PoC
 * step before it is a bug, let alone a report.
 *
 *   node scripts/hunt-oss-vulns.js               # all seed targets
 *   node scripts/hunt-oss-vulns.js owner/repo     # one repo, default subdir
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditCodebase } from '../src/codebase-audit.js';
import { classifyFindings, NODE_OSS_TARGETS, MODERATE_AI_TARGETS } from '../packages/core/bounties/oss-vuln-sweep.js';

const sh = promisify(execFile);

async function sweepOne({ repo, subdir }) {
  const dir = await mkdtemp(join(tmpdir(), 'sweep-'));
  try {
    await sh('git', ['clone', '--depth', '1', '--quiet', `https://github.com/${repo}`, dir], { maxBuffer: 5e7 });
    const root = subdir ? join(dir, subdir) : dir;
    const { findings } = await auditCodebase(root).then((r) => ({ findings: r.findings || r }));
    return classifyFindings(Array.isArray(findings) ? findings : [], { repo });
  } catch (e) {
    return { repo, error: String(e.message || e).slice(0, 120), security: [], quality: [] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const arg = process.argv[2];
// Both tiers sweep by default. The flagships are hardened and rarely yield a
// candidate; the moderate tier is where the detectors actually fire. Pass a repo
// slug to scan just one, or --flagships-only to restore the old flagship sweep.
const allTargets = [...NODE_OSS_TARGETS, ...MODERATE_AI_TARGETS];
const targets = arg === '--flagships-only'
  ? NODE_OSS_TARGETS
  : arg && !arg.startsWith('--')
  ? [allTargets.find((t) => t.repo === arg) || { repo: arg, subdir: '' }]
  : allTargets;

let totalCandidates = 0;
for (const t of targets) {
  process.stdout.write(`\n${t.repo}  `);
  const r = await sweepOne(t);
  if (r.error) { console.log(`(skipped: ${r.error})`); continue; }
  console.log(`security: ${r.security.length}  quality: ${r.quality.length}`);
  for (const c of r.security) {
    totalCandidates++;
    console.log(`  ⚠ ${c.cwe} ${c.file}:${c.line}`);
    console.log(`     ${c.evidence}`);
    console.log(`     PoC: ${c.poc}`);
  }
}
console.log(`\n${totalCandidates} security candidate(s) across ${targets.length} target(s).`);
console.log('Each is a lead, not a bug. Prove one with a running-instance PoC before reporting.');
