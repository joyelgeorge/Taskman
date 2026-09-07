import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

/**
 * Finds the bug classes an AI-written codebase hides from its own test suite.
 *
 * This is the delivery tool for the debugging gig. Without it the work is done by
 * reading files by hand, which is the difference between a ninety-minute order at
 * $60/hour and a six-hour one at $15/hour — and only one of those is a business.
 *
 * It reports candidates, not verdicts. Every finding is a place to look, with the
 * reason it is suspicious, and a human confirms it before it reaches a client
 * report. A scanner that asserts bugs it has not proven would produce exactly the
 * confident wrong answer this whole project exists to avoid.
 *
 * The four classes are the ones actually found in this repository, each of which
 * passed a 595-test suite:
 *
 *   storage-divergence   an in-memory fallback beside the real database path,
 *                        where the suite only ever runs the easy one
 *   missing-table        code writes to a table no migration creates
 *   silent-fallback      a catch that swallows the failure and reports success
 *   date-shift           a DATE read back through toISOString, wrong east of UTC
 */

const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'vendor']);

export async function collectFiles(root, { maxFiles = 2000 } = {}) {
  const found = [];
  async function walk(dir) {
    if (found.length >= maxFiles) return;
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length >= maxFiles) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR.has(entry.name) && !entry.name.startsWith('.')) await walk(full);
      } else if (CODE_EXT.has(extname(entry.name)) || entry.name.endsWith('.sql')) {
        found.push(full);
      }
    }
  }
  await walk(root);
  return found;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * An in-memory path beside a real one.
 *
 * The tell is a branch on whether a database is configured, with an object or
 * Map used when it is not. The suite then runs the branch that needs no
 * database, and the branch that ships is never executed.
 */
export function findStorageDivergence(file, text) {
  const findings = [];
  const branch = /if\s*\(\s*!\s*(databaseEnabled|db|pool|client|hasDb|isDbEnabled|process\.env\.DATABASE_URL)\b/g;
  for (const m of text.matchAll(branch)) {
    findings.push({
      kind: 'storage-divergence',
      file, line: lineOf(text, m.index),
      evidence: m[0],
      why: 'A branch that runs when no database is configured. If the test suite runs without '
        + 'DATABASE_URL, this is the only path it ever exercises, and the database path ships '
        + 'unverified.',
      confirm: 'Run the suite with a real database and see whether the count of executed tests '
        + 'or their results change.'
    });
  }
  return findings;
}

/** A catch that reports success. The failure disappears and the caller is lied to. */
export function findSilentFallback(file, text) {
  const findings = [];
  const pattern = /catch\s*(\([^)]*\))?\s*\{[^}]{0,400}?(ok\s*:\s*true|success\s*:\s*true|return\s+true)/gs;
  for (const m of text.matchAll(pattern)) {
    findings.push({
      kind: 'silent-fallback',
      file, line: lineOf(text, m.index),
      evidence: m[0].replace(/\s+/g, ' ').slice(0, 120),
      why: 'A caught error followed by a success result. Whatever failed is discarded and the '
        + 'caller is told it worked — the failure mode that looks like success and so is never '
        + 'investigated.',
      confirm: 'Force the guarded operation to fail and check what the caller receives.'
    });
  }
  return findings;
}

/** A DATE column read back through UTC conversion, which moves the day. */
export function findDateShift(file, text) {
  const findings = [];
  // Only DATE-shaped column names. An _at / _created / timestamp column is a
  // timestamptz, where toISOString is correct and unremarkable — including those
  // produced 29 findings here, nearly all of them fine. A DATE has no time, so
  // converting it to UTC is what moves the day.
  const pattern = /(\w*(?:_date|Date))\b\s*(?:\)|\s*\?\?[^\n]*)?\s*\.?\s*toISOString\s*\(\s*\)/g;
  for (const m of text.matchAll(pattern)) {
    findings.push({
      kind: 'date-shift',
      file, line: lineOf(text, m.index),
      evidence: m[0].slice(0, 80),
      why: 'node-postgres parses a DATE at local midnight, so toISOString converts it to UTC and '
        + 'moves the day backwards for every timezone east of Greenwich. Correct in UTC, wrong '
        + 'for most of the world.',
      confirm: 'Set TZ=Asia/Kolkata, write a known date, read it back, and compare.'
    });
  }
  return findings;
}

/**
 * A static-file path guard that anchors on a bare string prefix. Found in the
 * wild on 2026-09-07 in mergeos-bounties/mergeos frontend/server.js:248:
 *
 *   if (!requestedPath.startsWith(clientDist)) { res.statusCode = 403; ... }
 *
 * clientDist "/srv/app/dist" also prefixes "/srv/app/dist-backup", so a request
 * for "/..%2Fdist-backup%2F.env" normalises to a sibling directory the check
 * still accepts. It only bites when the path is decoded AFTER the URL is parsed,
 * because URL parsing would otherwise collapse the "../" — which is why the plain
 * form looks safe and the encoded form escapes. CWE-22.
 */
export function findPathPrefixGuard(file, text) {
  const findings = [];
  // A variable compared with startsWith against another variable (not a literal),
  // where the comparison is used as an access-control gate. Requiring both sides
  // to be identifiers keeps ordinary string checks like startsWith('/api') out.
  const pattern = /(\w+)\s*\.\s*startsWith\s*\(\s*(\w+)\s*\)/g;
  for (const m of text.matchAll(pattern)) {
    const [subject, boundary] = [m[1], m[2]];
    // A startsWith on a comment line is documentation, not a guard — including
    // this detector's own worked example. Skip anything whose line begins with a
    // comment marker.
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const linePrefix = text.slice(lineStart, m.index).trimStart();
    if (linePrefix.startsWith('*') || linePrefix.startsWith('//')) continue;
    // This must be a FILESYSTEM boundary, not a URL/route/auth check. Flowise
    // compares req.path against an auth whitelist with startsWith — same syntax,
    // not a traversal. A URL subject or a route/whitelist boundary is excluded,
    // and the file must actually touch the filesystem for a served-file escape
    // to be possible at all.
    if (/^(req|request|url|route|origin|referer|host|ctx)\b/i.test(subject)) continue;
    if (/url|route|endpoint|prefix|whitelist|allowlist|origin|host|domain/i.test(boundary)) continue;
    if (!/dir|root|base|dist|path|resolv|request|file|folder/i.test(subject + boundary)) continue;
    if (!/\b(path\.(join|resolve|normalize)|fs\.|readFile|createReadStream|sendFile|FileResponse)\b/.test(text)) continue;
    // Already anchored on a separator (startsWith(dir + '/') or dir + sep)? Safe.
    const tail = text.slice(m.index, m.index + 80);
    if (/\+\s*(['"`]\/|path\.sep|sep\b)/.test(tail)) continue;
    findings.push({
      kind: 'path-prefix-guard',
      file, line: lineOf(text, m.index),
      evidence: m[0].slice(0, 80),
      why: 'A filesystem access check that anchors on a bare string prefix. The intended '
        + 'directory also prefixes any sibling whose name extends it (dist vs dist-backup), so a '
        + 'normalised path into that sibling passes the check and escapes the sandbox. CWE-22 '
        + 'path traversal, and it hides because the URL-decoded form is what escapes, not the '
        + 'plain one.',
      confirm: 'Request a path that resolves to a sibling directory sharing the prefix, e.g. '
        + 'the URL-encoded "/..%2F<dir>-backup%2F.env", and check whether it is served.'
    });
  }
  return findings;
}

/**
 * A write must look like a whole SQL statement, not just a verb followed by a
 * word. Requiring the clause that always follows — VALUES or a column list after
 * INSERT INTO, SET after UPDATE, WHERE after DELETE FROM — removes the prose
 * matches that made "pull", "economic" and "lease" look like tables.
 */
const TABLE_WRITE = new RegExp(
  '\\bINSERT\\s+INTO\\s+([a-z_][a-z0-9_]*)\\s*[(]'
  + '|\\bINSERT\\s+INTO\\s+([a-z_][a-z0-9_]*)\\s+VALUES'
  + '|\\bUPDATE\\s+([a-z_][a-z0-9_]*)\\s+SET\\b'
  + '|\\bDELETE\\s+FROM\\s+([a-z_][a-z0-9_]*)\\s+WHERE\\b',
  'gi'
);

/**
 * Words that follow INSERT/UPDATE/DELETE and are not tables.
 *
 * The first version of this reported "set", "a" and "pr" as missing tables,
 * because UPDATE is followed by SET and because prose in a comment matches the
 * same shape. Eleven findings, one of them real. A scanner that is wrong ten
 * times out of eleven trains its reader to skip it, and the one true finding
 * goes with the rest.
 */
const NOT_A_TABLE = new Set([
  'set', 'values', 'where', 'from', 'select', 'into', 'table', 'only', 'the', 'a', 'an',
  'this', 'that', 'it', 'them', 'pr', 'if', 'and', 'or', 'not', 'null', 'on', 'as', 'by'
]);

/** A real table name: long enough, and not an English word that got matched. */
const looksLikeTable = name =>
  name.length >= 4 && !NOT_A_TABLE.has(name) && /^[a-z][a-z0-9_]*$/.test(name);
const TABLE_CREATE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;

/**
 * Tables the code writes to that nothing creates.
 *
 * Found here as outreach_drafts, which had been written to for months while a
 * catch quietly redirected every row into memory.
 */
export function findMissingTables({ writes, creates }) {
  const created = new Set(creates.map(c => c.table));
  const seen = new Set();
  const findings = [];
  for (const write of writes) {
    if (!looksLikeTable(write.table)) continue;
    if (created.has(write.table) || seen.has(write.table)) continue;
    seen.add(write.table);
    findings.push({
      kind: 'missing-table',
      file: write.file, line: write.line,
      evidence: `writes to "${write.table}", no CREATE TABLE found`,
      why: 'Code writes to a table no migration in this repository creates. Against a real '
        + 'database every one of those writes fails.',
      confirm: `Apply the migrations to an empty database and check whether ${write.table} exists.`
    });
  }
  return findings;
}

/**
 * Scans a repository and returns candidates, ordered so the findings that cost
 * money soonest are read first.
 */
export async function auditCodebase(root, { maxFiles = 2000 } = {}) {
  const files = await collectFiles(root, { maxFiles });
  const findings = [];
  const divergences = [];
  const writes = [];
  const creates = [];

  for (const file of files) {
    let text = '';
    try {
      const info = await stat(file);
      if (info.size > 1_000_000) continue; // generated or vendored
      text = await readFile(file, 'utf8');
    } catch { continue; }
    const rel = relative(root, file);

    if (file.endsWith('.sql')) {
      for (const m of text.matchAll(TABLE_CREATE)) creates.push({ table: m[1].toLowerCase() });
      continue;
    }
    if (/\.(test|spec)\.[jt]sx?$/.test(file)) continue; // tests are not the product

    for (const m of text.matchAll(TABLE_WRITE)) {
      const table = (m[1] || m[2] || m[3] || m[4] || '').toLowerCase();
      if (table) writes.push({ table, file: rel, line: lineOf(text, m.index) });
    }
    divergences.push(...findStorageDivergence(rel, text));
    findings.push(
      ...findSilentFallback(rel, text),
      ...findDateShift(rel, text),
      ...findPathPrefixGuard(rel, text)
    );
  }
  findings.push(...findMissingTables({ writes, creates }));

  // One finding, not one per branch. A hundred and thirty-five of these is not a
  // list of defects, it is a description of the architecture — and reporting it
  // that way buries the findings that are actually actionable. What matters is
  // whether the suite ever runs the other side.
  if (divergences.length) {
    findings.push({
      kind: 'storage-divergence',
      file: divergences[0].file, line: divergences[0].line,
      evidence: `${divergences.length} in-memory fallback branch(es) across `
        + `${new Set(divergences.map(d => d.file)).size} file(s)`,
      why: 'This codebase carries a complete second storage path that runs when no database is '
        + 'configured. If the suite runs without DATABASE_URL then that is the only path it has '
        + 'ever tested, and the path that ships is unverified. This is the single most common '
        + 'reason an AI-written application passes every test and fails in production.',
      confirm: 'Run the suite twice — once as normal, once with a real database — and compare '
        + 'pass counts and failures. Any difference is the unverified surface.',
      sample: divergences.slice(0, 8).map(d => `${d.file}:${d.line}`)
    });
  }

  // A write that fails outright outranks a path that is merely untested.
  const rank = { 'missing-table': 0, 'silent-fallback': 1, 'storage-divergence': 2, 'date-shift': 3 };
  findings.sort((a, b) => rank[a.kind] - rank[b.kind]);

  const byKind = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;

  return {
    root,
    filesScanned: files.length,
    tablesCreated: creates.length,
    findings,
    byKind,
    // Said plainly, because a scanner that implies certainty is worse than none.
    caveat: 'These are candidates, not confirmed defects. Each carries the check that would '
      + 'settle it. Confirm before putting any of this in front of a client.'
  };
}
