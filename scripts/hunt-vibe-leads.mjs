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
import { persistLeads } from '../packages/core/targets/lead-persistence.js';
import { SCAN_OUTCOME, recordScanned, selectUnscanned } from '../packages/core/targets/scan-memory.js';
import * as marketingStore from '../packages/core/marketing/store.js';
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

/**
 * How many repositories one sweep is willing to clone. A clone is the expensive
 * step, so this is the real budget and it should be a decision rather than an
 * accident of page size.
 */
const CANDIDATE_BUDGET = 120;
const PER_PAGE = 100;          // GitHub's maximum
const MAX_PAGES_PER_QUERY = 3;

/**
 * Candidate repositories to scan.
 *
 * Measured against the live API on 2026-09-12, the previous query set was
 * reaching almost none of its pool:
 *
 *   supabase stripe ... stars:5..400        ->     25 repos
 *   supabase stripe ... stars:0..4          ->  1,009 repos
 *   supabase stripe language:JavaScript ... ->      0 repos
 *
 * Two things were wrong. One query returned nothing at all and had been
 * contributing nothing since it was written. And the star floor was not merely
 * narrow, it was backwards: stars measure open-source popularity, and nobody
 * stars a company's product repository. They accumulate on templates and
 * starter kits, which is exactly what the business qualifier then spends its
 * time rejecting, so the two filters pulled against each other.
 *
 * The whole pool was also consumed in a single run — the sweep of 2026-09-12
 * scanned 35 candidates and the next run found zero new ones, leaving the cron
 * with nothing to do for the length of the rescan window. So this paginates to
 * a stated budget instead of taking one page and stopping.
 */
async function generateCandidates() {
  // Pool sizes measured against the live API on 2026-09-12 and recorded here so
  // a future change can see what it is trading away.
  const queries = [
    'supabase stripe pushed:>2026-06-01',              // 1,034
    'firebase stripe pushed:>2026-06-01',              //   296
    'lovable supabase pushed:>2026-06-01',             //   177
    '"built with lovable" pushed:>2026-06-01',         //   123
    '"bolt.new" supabase pushed:>2026-06-01'           //    11
  ];
  // Deliberately NOT `bolt.new OR v0.dev supabase`: GitHub does not apply that
  // OR the way it reads, and the query returned 41,406 repositories — bare
  // `supabase` returns 41,226. It matched almost everything and would have
  // flooded the budget with noise while looking like a targeted search.

  const seen = new Set();
  for (const q of queries) {
    for (let page = 1; page <= MAX_PAGES_PER_QUERY && seen.size < CANDIDATE_BUDGET; page += 1) {
      try {
        const { stdout } = await run('gh', ['api', '-X', 'GET', 'search/repositories',
          '--raw-field', `q=${q}`, '-f', 'sort=updated', '-f', `per_page=${PER_PAGE}`,
          '-f', `page=${page}`,
          '--jq', '.items[] | select(.archived==false and .fork==false) | .full_name'],
          { timeout: 30000 });
        const lines = stdout.trim().split('\n').filter(Boolean);
        // A query returning nothing is a fact worth seeing. The old set carried a
        // query that had matched zero repositories since it was written, and
        // nothing said so.
        if (page === 1 && lines.length === 0) console.warn(`  (query returned no results: ${q})`);
        for (const line of lines) seen.add(line);
        if (lines.length < PER_PAGE) break;   // last page for this query
      } catch (error) {
        console.warn(`  (query failed: ${q} — ${String(error.message || error).slice(0, 80)})`);
        break;
      }
    }
  }

  const all = [...seen];
  console.log(`${all.length} candidates from ${queries.length} queries (budget ${CANDIDATE_BUDGET})`);
  return all.slice(0, CANDIDATE_BUDGET);
}

const listFile = process.argv[2];
// A sweep that cannot store what it finds is worse than no sweep: it costs the
// clone budget and the rate limit, reports success, and leaves nothing behind.
// That was this funnel's original bug, and a missing env var reintroduces it
// silently - so in CI it is an error, not a warning.
const { databaseEnabled } = await import('@taskman/db');
if (!databaseEnabled) {
  const message = 'DATABASE_URL is not set — leads would be written to memory and lost on exit.';
  if (process.env.CI) {
    console.error(`FATAL: ${message}`);
    process.exit(1);
  }
  console.warn(`WARNING: ${message} Findings will print but not persist.`);
}

const requested = listFile
  ? (await import('node:fs')).readFileSync(listFile, 'utf8').trim().split('\n').filter(Boolean)
  : await generateCandidates();

// Spend the clone budget on repos we have not already looked at. Without this
// the same top-starred results come back from GitHub search every run and the
// sweep rediscovers last week's findings instead of widening the search.
const repos = await selectUnscanned(requested);
const skippedAsSeen = requested.length - repos.length;
if (skippedAsSeen > 0) {
  console.log(`skipping ${skippedAsSeen} repo(s) scanned recently; ${repos.length} new to scan`);
}
const leads = [];
for (const repo of repos) {
  const r = await scanRepo(repo);
  const crit = r.findings.filter((f) => f.severity === 'CRITICAL').length;
  const isLead = r.findings.length && r.genuine;
  const tag = r.error ? 'skip' : isLead ? 'LEAD' : (r.findings.length && !r.genuine) ? 'vuln·toy' : '  ok';
  process.stdout.write(`${tag}  ${repo}  ${r.findings.length ? `(${r.findings.length} issues, ${crit} crit)` : ''}${r.findings.length && !r.genuine ? ' — not a business: ' + (r.qual.rejections[0] || 'no traction') : ''}${r.error ? ' ' + r.error : ''}\n`);
  if (isLead) leads.push(r);

  // Remember it either way, so the next run can spend its budget elsewhere.
  try {
    await recordScanned({
      repo,
      outcome: r.error ? SCAN_OUTCOME.ERROR
        : isLead ? SCAN_OUTCOME.LEAD
        : r.findings.length ? SCAN_OUTCOME.VULN_NOT_BUSINESS
        : SCAN_OUTCOME.CLEAN,
      findingCount: r.findings.length
    });
  } catch (memoryErr) {
    console.warn(`  (could not record scan memory for ${repo}: ${memoryErr.message})`);
  }
}
leads.sort((a, b) => b.findings.filter(f=>f.severity==='CRITICAL').length - a.findings.filter(f=>f.severity==='CRITICAL').length || b.findings.length - a.findings.length);
// /tmp dies with the CI runner, so this file is a convenience for a local run,
// never the record. The record is the leads table.
await writeFile('/tmp/vibe-leads.json', JSON.stringify(leads, null, 2));

// Persist finding CLASS only - never a path, a line or an excerpt. Leads land
// as NEW; the disclosure-first rule still puts a human before any outreach.
try {
  const saved = await persistLeads(leads, { store: marketingStore });
  console.log(`persisted: ${saved.created} new, ${saved.updated} updated, `
    + `${saved.skipped} not leads, ${saved.failed} failed`);
  for (const e of saved.errors) console.warn(`  persist failed ${e.repo}: ${e.message}`);
} catch (persistErr) {
  // A storage failure must not discard the scan output the run just paid for.
  console.warn(`could not persist leads: ${persistErr.message}`);
}
console.log(`\n=== ${leads.length} LEADS (repos with confirmed findings) of ${repos.length} scanned ===`);
for (const l of leads) {
  const kinds = [...new Set(l.findings.map(f => f.kind))].join(', ');
  console.log(`  ${l.repo}  —  ${l.findings.length} issues [${kinds}]`);
}
