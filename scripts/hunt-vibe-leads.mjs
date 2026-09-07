#!/usr/bin/env node
/**
 * Lead-generation drone for the AI-app security scan service. Reads a list of
 * PUBLIC repos, scans each with the vibe-coded detectors, and records the ones
 * with confirmed findings as leads. Read-only and public-source-only: it clones
 * and deletes, never probes a live system, never stores a secret value.
 *
 * A lead is a repo with a real, disclosable security bug — someone who both
 * needs the fix and can be shown, for free, that the problem is real. Outreach
 * is a separate, human step: this drone produces the list and the evidence, it
 * sends nothing.
 *
 *   node scripts/hunt-vibe-leads.mjs <repo-list-file>
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditCodebase } from '../src/codebase-audit.js';

const run = promisify(execFile);
const SELLABLE = new Set(['exposed-secret', 'missing-rls', 'open-cors', 'ssrf', 'command-injection', 'path-prefix-guard']);
const CRITICAL = new Set(['exposed-secret', 'missing-rls']);

async function scanRepo(repo) {
  const dir = await mkdtemp(join(tmpdir(), 'lead-'));
  try {
    await run('git', ['clone', '--depth', '1', '--single-branch', `https://github.com/${repo}.git`, dir], { timeout: 60000 });
    const result = await auditCodebase(dir);
    const findings = (result.findings || result).filter((f) => SELLABLE.has(f.kind));
    // Never keep a secret value, even the truncated evidence. Record class + location only.
    const safe = findings.map((f) => ({
      kind: f.kind,
      severity: CRITICAL.has(f.kind) ? 'CRITICAL' : 'HIGH',
      file: f.file, line: f.line
    }));
    return { repo, findings: safe, error: null };
  } catch (e) {
    return { repo, findings: [], error: String(e.message || e).slice(0, 80) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const listFile = process.argv[2];
const repos = (await import('node:fs')).readFileSync(listFile, 'utf8').trim().split('\n').filter(Boolean);
const leads = [];
for (const repo of repos) {
  const r = await scanRepo(repo);
  const crit = r.findings.filter((f) => f.severity === 'CRITICAL').length;
  process.stdout.write(`${r.error ? 'skip' : (r.findings.length ? 'LEAD' : '  ok')}  ${repo}  ${r.findings.length ? `(${r.findings.length} issues, ${crit} critical)` : (r.error || '')}\n`);
  if (r.findings.length) leads.push(r);
}
leads.sort((a, b) => b.findings.filter(f=>f.severity==='CRITICAL').length - a.findings.filter(f=>f.severity==='CRITICAL').length || b.findings.length - a.findings.length);
await writeFile('/tmp/vibe-leads.json', JSON.stringify(leads, null, 2));
console.log(`\n=== ${leads.length} LEADS (repos with confirmed findings) of ${repos.length} scanned ===`);
for (const l of leads) {
  const kinds = [...new Set(l.findings.map(f => f.kind))].join(', ');
  console.log(`  ${l.repo}  —  ${l.findings.length} issues [${kinds}]`);
}
