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
 * A server-side HTTP request whose destination is built from what looks like
 * external input. If an attacker controls the URL, they can make the server
 * reach internal-only hosts — cloud metadata at 169.254.169.254, localhost
 * admin ports, other services on the private network. CWE-918 SSRF, and these
 * AI/ML apps are full of it: "summarise this URL", "import from webhook",
 * "load avatar from link" all take a URL from the user and fetch it.
 *
 * The hard part is precision. Almost every app calls fetch/axios with a dynamic
 * URL to reach a KNOWN API, which is not SSRF. So a bare dynamic URL is not
 * enough — the destination must look attacker-influenced: either the URL token
 * is named like external input (url, endpoint, target, webhook, callback,
 * redirect, imageUrl, ...) or a request object is referenced close by. A URL
 * that is a plain string literal is skipped outright.
 */
export function findSSRF(file, text) {
  const findings = [];
  // Server-side request sinks. node-fetch/fetch, axios (and its verbs), got,
  // needle, superagent, and raw http(s).get/request.
  const sink = /\b(fetch|got|needle|superagent)\s*\(|\baxios(?:\.(?:get|post|put|delete|request|head))?\s*\(|\b(?:https?|http|https)\.(?:get|request)\s*\(/g;
  // Case-insensitive so camelCase tails match (targetUrl, imageUrl, fetchUrl),
  // and deliberately NOT matching the sink verb itself (fetch/get) — only the
  // destination noun. A URL argument named for external input is the SSRF tell.
  const INPUT_SHAPED = /url|uri|endpoint|\bwebhook|callback|redirect|href|\blink\b|\btarget|\bremote\b|\bhost\b|\baddress\b|avatar|proxy/i;
  const REQUEST_SOURCE = /\b(req|request|ctx)\.(query|params|body|headers)\b|\breq\.(url|originalUrl)\b/;
  for (const m of text.matchAll(sink)) {
    const lineEnd = text.indexOf('\n', m.index);
    const arg = text.slice(m.index, lineEnd === -1 ? m.index + 200 : lineEnd);
    // A static string URL (no interpolation, no bare variable) is not SSRF.
    const dynamic = /`[^`]*\$\{/.test(arg) || /\(\s*[A-Za-z_$][\w$.]*\s*[,)]/.test(arg);
    if (!dynamic) continue;
    // The destination must be tied to request data. A dynamic URL alone is not
    // SSRF — apps fetch configured provider endpoints (CATALOG_URL, baseURL) all
    // day, and a variable merely named `url` matched 34 of those in anything-llm
    // on a first run. The tell is a request source (req.query/body/params) close
    // to the call; INPUT_SHAPED only raises confidence, it does not qualify.
    const window = text.slice(Math.max(0, m.index - 240), m.index + 240);
    const nearRequest = REQUEST_SOURCE.test(window);
    if (!nearRequest) continue;
    const inputNamed = INPUT_SHAPED.test(arg);
    findings.push({
      kind: 'ssrf',
      file, line: lineOf(text, m.index),
      evidence: arg.trim().slice(0, 90),
      why: 'A server-side HTTP request whose destination is tied to request data'
        + (inputNamed ? ' and named like an external URL' : '')
        + '. If the URL is attacker-controlled and unvalidated, the server can be made to reach '
        + 'internal hosts — cloud metadata (169.254.169.254), localhost admin ports, private '
        + 'services. CWE-918 server-side request forgery.',
      confirm: 'Trace the URL to its source. If it reaches this call without an allowlist or a '
        + 'block on private/link-local ranges, point it at http://169.254.169.254/ or '
        + 'http://127.0.0.1:<port>/ against a running instance and check the server fetches it.'
    });
  }
  return findings;
}

/**
 * A shell command built from a template literal or string concatenation, passed
 * to child_process.exec/execSync. The interpolated value becomes shell syntax,
 * so an input containing `; rm -rf ~` or `$(...)` runs as a second command. This
 * is the class these AI/ML apps are most exposed to, because they routinely
 * shell out to ffmpeg, git, python and pandoc with a user-supplied name, path or
 * URL in the command line. CWE-78.
 *
 * Precision matters as much as recall. exec with a STATIC string is fine and is
 * skipped. execFile/spawn with an argument array (and no `shell: true`) is the
 * safe pattern and is skipped. Only a dynamic command handed to a shell sink is
 * flagged, and the flag says which sink and how the value gets in.
 */
export function findCommandInjection(file, text) {
  const findings = [];
  // exec / execSync as a SHELL call — a bare/destructured exec(...) or one on a
  // child_process alias. The negative lookbehind excludes regex.exec(str) and
  // any other obj.exec, which are unrelated to the shell and were the bulk of
  // the noise on a first live run (minified axios matched dozens of them).
  const shellSink = /(?<![.\w])(exec|execSync)\s*\(|\b(?:child_process|childProcess|cp|proc)\.(exec|execSync)\s*\(/g;
  for (const m of text.matchAll(shellSink)) {
    const sink = m[1] || m[2];
    // The first argument, up to the end of its line — shell commands are written
    // on one line in practice, and this keeps the match from bleeding into the
    // callback body that often follows.
    const lineEnd = text.indexOf('\n', m.index);
    const arg = text.slice(m.index, lineEnd === -1 ? m.index + 300 : lineEnd);
    const interpolated = /`[^`]*\$\{/.test(arg);          // exec(`... ${x} ...`)
    const concatenated = /['"]\s*\+|\+\s*['"]/.test(arg);  // exec('...' + x) / exec(x + '...')
    if (!interpolated && !concatenated) continue;          // static command, safe
    findings.push({
      kind: 'command-injection',
      file, line: lineOf(text, m.index),
      evidence: arg.trim().slice(0, 90),
      why: 'A shell command assembled from a ' + (interpolated ? 'template literal' : 'concatenated string')
        + ' and run through ' + sink + '. Any shell metacharacter in the interpolated value — a semicolon, '
        + 'backtick or $(...) — executes as an additional command. CWE-78 command injection.',
      confirm: 'Trace the interpolated value to a request parameter, filename or URL. If it reaches this '
        + 'line unescaped, a value like "x; id" or "$(id)" runs on the server. Prove it against a running '
        + 'instance before reporting.'
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
    // A served-file escape needs the guarded path to reach a read-or-serve sink.
    // n8n uses module.startsWith(watchPath) to filter require.cache keys for hot
    // reload — a path check with no file served and no attacker input, so the
    // bare presence of path.join is not enough. Require an actual serve/read sink.
    if (!/\b(sendFile|FileResponse|createReadStream|readFileSync|readFile|res\.download|sendfile)\b/.test(text)) continue;
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
/**
 * Secrets that ship to the client — the bug the vibe-coded market is actually
 * paying to fix (Lovable/Cursor/Bolt + Supabase apps). Two things, both static:
 *
 *  1. A Supabase service_role key hardcoded anywhere. It is a JWT whose payload
 *     says {"role":"service_role"} and it BYPASSES Row-Level Security — full
 *     read/write to every table. We decode the JWT payload to confirm the role
 *     rather than guessing from the variable name, so an anon key (safe to ship)
 *     is not flagged and a service_role key hidden in an oddly-named const is.
 *  2. A hardcoded provider secret with an unambiguous prefix (Stripe live, AWS,
 *     GitHub, Slack, Google, OpenAI). These are real credentials, not config.
 *
 * process.env references and obvious placeholders are excluded — those are the
 * safe patterns, and flagging them would be the noise that discredits the scan.
 */
export function findExposedSecret(file, text) {
  const findings = [];
  const isPlaceholder = (v) => /^(your|my|xxx+|todo|example|changeme|placeholder|\.\.\.|<|test|dummy|fake|sample)/i.test(v) || v.length < 12;

  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    let role = '', ref = '', iss = '';
    try {
      const json = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const p = JSON.parse(json);
      role = p.role || ''; ref = p.ref || ''; iss = p.iss || '';
    } catch { continue; }
    if (role !== 'service_role') continue;
    // The Supabase LOCAL-DEV demo key is public by design — it ships with every
    // `supabase start`, is in Supabase's own docs, and points at 127.0.0.1. It
    // has issuer "supabase-demo" and no project ref. A real production key always
    // carries a project ref. Flagging the demo key is a false leak report.
    if (iss === 'supabase-demo' || !ref) continue;
    findings.push({
      kind: 'exposed-secret',
      file, line: lineOf(text, m.index),
      evidence: m[0].slice(0, 24) + '… (JWT role=service_role)',
      why: 'A Supabase service_role key is hardcoded here. It bypasses Row-Level Security entirely, '
        + 'granting full read/write to every table. If this file is shipped to the browser or committed '
        + 'to a public repo, anyone can read and modify the whole database. CWE-798 / CWE-312.',
      confirm: 'Confirm the file reaches the client bundle or a public repo. Then the key alone is enough '
        + 'to call the REST API with service_role privileges — rotate it immediately.'
    });
  }

  const providerKey = /(sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{32,})/g;
  for (const m of text.matchAll(providerKey)) {
    const val = m[1];
    if (isPlaceholder(val)) continue;
    const around = text.slice(Math.max(0, m.index - 40), m.index);
    if (/process\.env\.[A-Za-z0-9_]*\s*[:=]?\s*$/.test(around)) continue;
    findings.push({
      kind: 'exposed-secret',
      file, line: lineOf(text, m.index),
      evidence: val.slice(0, 10) + '…',
      why: 'A live provider credential is hardcoded in source. If this ships to the client or a public repo '
        + 'it can be used directly to spend money or access accounts. CWE-798 hardcoded credentials.',
      confirm: 'Confirm the file is client-shipped or public, then rotate the key. Secrets belong in server-side env, never in source.'
    });
  }
  return findings;
}

/**
 * A CORS policy that reflects or wildcards the origin WHILE allowing
 * credentials. `origin: '*'` with `credentials: true` is invalid per the fetch
 * spec, so vibe-coded backends instead reflect the request origin back, which
 * lets any site make authenticated cross-origin calls with the victim's cookies.
 */
export function findOpenCors(file, text) {
  const findings = [];
  const hasCreds = /credentials\s*:\s*true/.test(text);
  const patterns = [
    { re: /origin\s*:\s*['"]\*['"]/g, kind: 'wildcard' },
    { re: /origin\s*:\s*(req|request)\.headers\.origin/g, kind: 'reflect' },
    { re: /['"]Access-Control-Allow-Origin['"]\s*,\s*['"]\*['"]/g, kind: 'wildcard-header' }
  ];
  for (const { re, kind } of patterns) {
    for (const m of text.matchAll(re)) {
      if (kind !== 'reflect' && !hasCreds) continue;
      findings.push({
        kind: 'open-cors',
        file, line: lineOf(text, m.index),
        evidence: m[0].slice(0, 60),
        why: 'CORS ' + (kind === 'reflect' ? 'reflects the request origin' : 'wildcards the origin')
          + ' while credentials are allowed. Any website the victim visits can make authenticated '
          + 'cross-origin requests carrying their cookies/session. CWE-942 permissive CORS.',
        confirm: 'From another origin, make a credentialed request and check the response is readable. '
          + 'Restrict the origin to an explicit allowlist.'
      });
    }
  }
  return findings;
}

/**
 * Missing Row-Level Security on a Supabase table — the single most common
 * vibe-coded catastrophe. A table created in supabase/migrations that never gets
 * ENABLE ROW LEVEL SECURITY is readable and writable by anyone holding the anon
 * key, which ships in the browser by design. Gated to the supabase/ path so a
 * normal server-side Postgres schema (where no-RLS is fine) is not flagged.
 */
export function findMissingRls({ supabaseCreates = [], rlsEnabled = new Set() }) {
  const findings = [];
  const seen = new Set();
  for (const c of supabaseCreates) {
    if (rlsEnabled.has(c.table) || seen.has(c.table)) continue;
    seen.add(c.table);
    findings.push({
      kind: 'missing-rls',
      file: c.file, line: c.line,
      evidence: `create table ${c.table} (no ENABLE ROW LEVEL SECURITY)`,
      why: `Supabase table "${c.table}" is created without Row-Level Security. With RLS off, anyone `
        + 'holding the anon key — which ships in the client bundle by design — can read and write every '
        + 'row via the public REST API. This is the most common vibe-coded data breach. CWE-284 broken access control.',
      confirm: `Call the REST endpoint /rest/v1/${c.table} with only the anon key. If rows come back (or a `
        + 'write succeeds), RLS is off. Fix: ALTER TABLE ' + c.table + ' ENABLE ROW LEVEL SECURITY plus explicit policies.'
    });
  }
  return findings;
}

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
  const supabaseCreates = [];
  const rlsEnabled = new Set();

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
      // Supabase migrations: track table creates and which tables enable RLS, so
      // findMissingRls can flag the ones left world-accessible via the anon key.
      if (/supabase/i.test(rel)) {
        // Supabase writes schema-qualified, sometimes-quoted names:
        //   create table public.foo (...);  alter table public."foo" enable row level security;
        // Capture the LAST identifier (the real table), stripping an optional
        // schema prefix and quotes on BOTH sides, or every table looks unprotected
        // because "public" (the schema) never matches the enabled table name.
        // Strip line comments first and require a column list "(" after the name,
        // so "-- create table for storing X" (a comment) is not read as a table.
        const sql = text.replace(/--[^\n]*/g, '');
        // Only the `public` schema is exposed through Supabase's REST API, so a
        // table in another schema (e.g. internal.cron_secret, revoked from public)
        // is not the vulnerability — capture the schema and skip non-public ones.
        const SB_CREATE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
        const SB_RLS = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"?[a-z_][a-z0-9_]*"?\.)?"?([a-z_][a-z0-9_]*)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
        for (const m of sql.matchAll(SB_CREATE)) {
          const schema = (m[1] || 'public').toLowerCase();
          if (schema !== 'public') continue; // not API-exposed
          supabaseCreates.push({ table: m[2].toLowerCase(), file: rel, line: lineOf(text, m.index) });
        }
        for (const m of sql.matchAll(SB_RLS)) rlsEnabled.add(m[1].toLowerCase());
      }
      continue;
    }
    if (/\.(test|spec)\.[jt]sx?$/.test(file)) continue; // tests are not the product
    // Vendored and minified third-party code is not this project's to fix, and a
    // minified bundle on one line defeats line-based matching (a whole axios.min
    // looked like dozens of exec calls). Skip it.
    if (/\.min\.[jt]s$|[\\/](vendor|vendored|third[_-]?party|libraries|node_modules)[\\/]/i.test(file)) continue;

    for (const m of text.matchAll(TABLE_WRITE)) {
      const table = (m[1] || m[2] || m[3] || m[4] || '').toLowerCase();
      if (table) writes.push({ table, file: rel, line: lineOf(text, m.index) });
    }
    divergences.push(...findStorageDivergence(rel, text));
    // Drop any finding whose own line is a // line comment or a * block-comment
    // continuation. Commented-out code (a disabled execSync, a sample fetch) is
    // not a live vulnerability, and matching it was inflating the lead drone.
    const srcLines = text.split('\n');
    const notCommented = (f) => {
      const ln = (srcLines[f.line - 1] || '').trimStart();
      return !ln.startsWith('//') && !ln.startsWith('*');
    };
    findings.push(...[
      ...findSilentFallback(rel, text),
      ...findDateShift(rel, text),
      ...findPathPrefixGuard(rel, text),
      ...findCommandInjection(rel, text),
      ...findSSRF(rel, text),
      ...findExposedSecret(rel, text),
      ...findOpenCors(rel, text)
    ].filter(notCommented));
  }
  findings.push(...findMissingTables({ writes, creates }));
  findings.push(...findMissingRls({ supabaseCreates, rlsEnabled }));

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
