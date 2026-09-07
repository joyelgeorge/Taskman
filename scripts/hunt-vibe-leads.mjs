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
import { qualifyLead, BUSINESS_CODE_SIGNALS } from '../packages/core/targets/lead-qualifier.js';
import { readFileSync } from 'node:fs';

const run = promisify(execFile);
const SELLABLE = new Set(['exposed-secret', 'missing-rls', 'open-cors', 'ssrf', 'command-injection', 'path-prefix-guard']);
const CRITICAL = new Set(['exposed-secret', 'missing-rls']);
// Injection/traversal classes in dev/build tooling have no remote attacker — the
// same false positives the OSS sweep learned to drop. Keep them only in app code.
const NEEDS_SERVER = new Set(['command-injection', 'path-prefix-guard', 'ssrf']);
const TOOLING = /(^|\/)(scripts?|bin|tools?|test|tests|__tests__|examples?|dist)\/|\.(config|test|spec)\.|(^|\/)(vite|webpack|rollup|esbuild|next|svelte|astro)\.config/i;

async function repoMeta(repo) {
  try {
    const { stdout } = await run('gh', ['api', 'repos/' + repo, '--jq',
      '{name,description,homepage,stargazers_count,forks_count,archived,fork,created_at,pushed_at,has_pages}'], { timeout: 20000 });
    return JSON.parse(stdout);
  } catch { return { name: repo }; }
}

async function scanRepo(repo) {
  const dir = await mkdtemp(join(tmpdir(), 'lead-'));
  try {
    await run('git', ['clone', '--depth', '1', '--single-branch', `https://github.com/${repo}.git`, dir], { timeout: 60000 });
    const result = await auditCodebase(dir);
    const findings = (result.findings || result).filter((f) => SELLABLE.has(f.kind) && !(NEEDS_SERVER.has(f.kind) && TOOLING.test(f.file)));
    // Never keep a secret value, even the truncated evidence. Record class + location only.
    const safe = findings.map((f) => ({
      kind: f.kind,
      severity: CRITICAL.has(f.kind) ? 'CRITICAL' : 'HIGH',
      file: f.file, line: f.line
    }));
    let pkg = '';
    try { pkg = readFileSync(join(dir, 'package.json'), 'utf8'); } catch {}
    const code = { hasPayments: BUSINESS_CODE_SIGNALS.payments.test(pkg), hasAuth: BUSINESS_CODE_SIGNALS.auth.test(pkg) };
    const meta = await repoMeta(repo);
    const qual = qualifyLead(meta, code);
    return { repo, findings: safe, genuine: qual.genuine, qual, error: null };
  } catch (e) {
    return { repo, findings: [], error: String(e.message || e).slice(0, 80) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function generateCandidates() {
  // Genuine-business signal: Supabase paired with a payments integration.
  const queries = [
    'supabase stripe language:TypeScript stars:5..400 pushed:>2026-06-01',
    'supabase stripe saas language:TypeScript pushed:>2026-07-01',
    'supabase stripe subscription language:JavaScript stars:3..300 pushed:>2026-06-01'
  ];
  const seen = new Set();
  for (const q of queries) {
    try {
      const { stdout } = await run('gh', ['api', '-X', 'GET', 'search/repositories',
        '--raw-field', `q=${q}`, '-f', 'sort=stars', '-f', 'per_page=25',
        '--jq', '.items[] | select(.archived==false and .fork==false) | .full_name'], { timeout: 25000 });
      for (const line of stdout.trim().split('\n')) if (line) seen.add(line);
    } catch {}
  }
  return [...seen];
}

const listFile = process.argv[2];
const repos = listFile
  ? (await import('node:fs')).readFileSync(listFile, 'utf8').trim().split('\n').filter(Boolean)
  : await generateCandidates();
const leads = [];
for (const repo of repos) {
  const r = await scanRepo(repo);
  const crit = r.findings.filter((f) => f.severity === 'CRITICAL').length;
  const isLead = r.findings.length && r.genuine;
  const tag = r.error ? 'skip' : isLead ? 'LEAD' : (r.findings.length && !r.genuine) ? 'vuln·toy' : '  ok';
  process.stdout.write(`${tag}  ${repo}  ${r.findings.length ? `(${r.findings.length} issues, ${crit} crit)` : ''}${r.findings.length && !r.genuine ? ' — not a business: ' + (r.qual.rejections[0] || 'no traction') : ''}${r.error ? ' ' + r.error : ''}\n`);
  if (isLead) leads.push(r);
}
leads.sort((a, b) => b.findings.filter(f=>f.severity==='CRITICAL').length - a.findings.filter(f=>f.severity==='CRITICAL').length || b.findings.length - a.findings.length);
await writeFile('/tmp/vibe-leads.json', JSON.stringify(leads, null, 2));
console.log(`\n=== ${leads.length} LEADS (repos with confirmed findings) of ${repos.length} scanned ===`);
for (const l of leads) {
  const kinds = [...new Set(l.findings.map(f => f.kind))].join(', ');
  console.log(`  ${l.repo}  —  ${l.findings.length} issues [${kinds}]`);
}
