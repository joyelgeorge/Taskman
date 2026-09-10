import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findSilentFallback, findDateShift, findMissingTables, findStorageDivergence
, findPathPrefixGuard, findCommandInjection, findSSRF, findExposedSecret, findOpenCors, findMissingRls } from '../src/codebase-audit.js';

test('a catch that returns success is reported', () => {
  // The shape that hid outreach_drafts for months: the write failed on every
  // call, the error was swallowed, and the caller was told it saved.
  const code = `try { await query('INSERT INTO x'); } catch (err) { mem.set(id, row); return { ok: true }; }`;
  const [finding] = findSilentFallback('a.js', code);
  assert.equal(finding.kind, 'silent-fallback');
  assert.match(finding.why, /told it worked/);
  assert.ok(finding.confirm, 'every finding must carry the check that settles it');
});

test('an ordinary catch that rethrows or returns failure is left alone', () => {
  assert.equal(findSilentFallback('a.js', `try { x(); } catch (e) { throw e; }`).length, 0);
  assert.equal(findSilentFallback('a.js', `try { x(); } catch (e) { return { ok: false }; }`).length, 0);
});

test('a DATE run through toISOString is reported; a timestamp is not', () => {
  // A DATE has no time, so converting it to UTC moves the day. An _at column is
  // a timestamptz where the same call is correct — including those produced 29
  // findings on a real repository, almost all of them fine.
  assert.equal(findDateShift('a.js', 'row.bucket_date.toISOString()').length, 1);
  assert.equal(findDateShift('a.js', 'row.snapshotDate.toISOString()').length, 1);
  assert.equal(findDateShift('a.js', 'row.created_at.toISOString()').length, 0);
  assert.equal(findDateShift('a.js', 'row.startedAt.toISOString()').length, 0);
});

test('only real SQL writes count as writes to a missing table', () => {
  // The first version reported "set", "a" and "pr" as tables — UPDATE is followed
  // by SET, and prose in a comment matches the same shape. Eleven findings, one
  // real. A scanner wrong ten times in eleven teaches its reader to skip it.
  const writes = [
    { table: 'outreach_drafts', file: 'a.js', line: 1 },
    { table: 'settlements', file: 'b.js', line: 2 }
  ];
  const findings = findMissingTables({ writes, creates: [{ table: 'settlements' }] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].evidence.includes('outreach_drafts'), true);
});

test('an in-memory fallback branch is detected', () => {
  const found = findStorageDivergence('a.js', 'if (!databaseEnabled) { return mem.all(); }');
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'storage-divergence');
});

test('findings are candidates and say so, never verdicts', async () => {
  const { auditCodebase } = await import('../src/codebase-audit.js');
  const result = await auditCodebase(process.cwd(), { maxFiles: 40 });
  assert.match(result.caveat, /candidates, not confirmed/);
  for (const f of result.findings) {
    assert.ok(f.confirm, `${f.kind} must say how to settle it`);
  }
});

test('findPathPrefixGuard catches the mergeos CWE-22 prefix bug', () => {
  const src = `
    const requestedPath = path.normalize(path.join(clientDist, pathname));
    if (!requestedPath.startsWith(clientDist)) { res.statusCode = 403; return; }
    createReadStream(requestedPath).pipe(res);
  `;
  const f = findPathPrefixGuard('server.js', src);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'path-prefix-guard');
});

test('findPathPrefixGuard passes a guard anchored on a separator', () => {
  const ok = `if (!requestedPath.startsWith(clientDist + path.sep)) return deny();`;
  assert.equal(findPathPrefixGuard('server.js', ok).length, 0);
  const ok2 = `if (!file.startsWith(publicDir + '/')) return deny();`;
  assert.equal(findPathPrefixGuard('server.js', ok2).length, 0);
});

test('findPathPrefixGuard ignores a startsWith in a comment', () => {
  const commented = ` * if (!requestedPath.startsWith(clientDist)) { ... }  // example`;
  assert.equal(findPathPrefixGuard('server.js', commented).length, 0);
});

test('findPathPrefixGuard ignores non-path string checks', () => {
  const routing = `if (url.startsWith(prefix)) route();`;
  assert.equal(findPathPrefixGuard('router.js', routing).length, 0);
});

test('findPathPrefixGuard ignores a URL/auth whitelist check (Flowise false positive)', () => {
  // Real code from FlowiseAI/Flowise src/index.ts: an auth whitelist, not a file guard.
  const src = `
    const fs = require('fs');
    const isWhitelisted = whitelistURLs.some((url) => req.path.startsWith(url));
  `;
  assert.equal(findPathPrefixGuard('index.ts', src).length, 0);
});

test('findPathPrefixGuard requires the file to actually touch the filesystem', () => {
  const noFs = `if (!requestedPath.startsWith(clientDist)) deny();`;
  assert.equal(findPathPrefixGuard('router.js', noFs).length, 0, 'no fs sink => not a served-file escape');
  const withFs = `const p = path.join(dir, x);\nif (!requestedPath.startsWith(clientDist)) deny();\nfs.createReadStream(p);`;
  assert.equal(findPathPrefixGuard('server.js', withFs).length, 1);
});

test('findPathPrefixGuard ignores a require.cache hot-reload filter (n8n false positive)', () => {
  // Real code from n8n load-nodes-and-credentials.ts: filters require.cache keys
  // for hot reload. A path check, but nothing is served and no input is involved.
  const src = `
    const p = path.join(customNodesRoot, entry.name);
    const modules = Object.keys(require.cache).filter((module) => module.startsWith(watchPath));
  `;
  assert.equal(findPathPrefixGuard('loader.ts', src).length, 0);
});

test('findCommandInjection flags exec built by interpolation and concatenation', () => {
  assert.equal(findCommandInjection('a.js', 'exec(`convert ${userFile} out.png`)').length, 1);
  assert.equal(findCommandInjection('a.js', "execSync('git clone ' + repoUrl)").length, 1);
  assert.equal(findCommandInjection('a.js', 'child_process.exec(`ffmpeg -i ${src}`)').length, 1);
});

test('findCommandInjection leaves safe shell usage alone', () => {
  assert.equal(findCommandInjection('a.js', "exec('ls -la /tmp')").length, 0, 'static command');
  assert.equal(findCommandInjection('a.js', "execFile('git', ['clone', repoUrl])").length, 0, 'array args, no shell');
  assert.equal(findCommandInjection('a.js', "spawn('ffmpeg', args)").length, 0, 'spawn without shell');
});

test('findCommandInjection ignores regex.exec — the minified-axios false positive', () => {
  assert.equal(findCommandInjection('axios.js', 'const m = /ab${x}/.exec(str)').length, 0);
  assert.equal(findCommandInjection('p.js', "pattern.exec('x' + y)").length, 0);
});

test('the scanner skips vendored and minified third-party code', async () => {
  // A .min.js with an interpolated exec must not be reported — not ours to fix,
  // and one-line bundles defeat line matching.
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'vend-'));
  try {
    await writeFile(join(dir, 'vendor.min.js'), 'exec(`rm ${x}`)');
    const { auditCodebase } = await import('../src/codebase-audit.js');
    const r = await auditCodebase(dir);
    const f = (r.findings || r).filter((x) => x.kind === 'command-injection');
    assert.equal(f.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findSSRF flags a server request whose URL comes from request data', () => {
  assert.equal(findSSRF('a.js', 'await fetch(req.body.webhook)').length, 1);
  assert.equal(findSSRF('a.js', 'axios.get(`${req.query.url}/data`)').length, 1);
  const nearby = 'const url = req.body.url;\n  const r = await fetch(url);';
  assert.equal(findSSRF('a.js', nearby).length, 1);
});

test('findSSRF does not flag a request to a configured provider endpoint', () => {
  // The anything-llm false positives: dynamic URL, but a configured destination,
  // no request data in sight.
  assert.equal(findSSRF('a.js', 'fetch(this.CATALOG_URL, { headers })').length, 0);
  assert.equal(findSSRF('a.js', 'fetch(`${baseURL}/images/edits`, {})').length, 0);
  assert.equal(findSSRF('a.js', 'const r = await fetch(url)').length, 0, 'dynamic url, no request source');
});

test('findSSRF leaves a static literal URL alone', () => {
  assert.equal(findSSRF('a.js', "fetch('https://api.stripe.com/v1/charges')").length, 0);
});


function jwtFor(role) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${b64({ role, iss: 'supabase', ref: 'abcd' })}.${'x'.repeat(43)}`;
}

test('findExposedSecret flags a hardcoded Supabase service_role key (bypasses RLS)', () => {
  assert.equal(findExposedSecret('client.ts', `createClient(url, "${jwtFor('service_role')}")`).length, 1);
});

test('findExposedSecret leaves an anon key alone — it is meant to be public', () => {
  assert.equal(findExposedSecret('client.ts', `createClient(url, "${jwtFor('anon')}")`).length, 0);
});

test('findExposedSecret flags unambiguous provider keys but not env refs or placeholders', () => {
  assert.equal(findExposedSecret('a.js', 'const s = "sk_live_abcdef0123456789ABCDEF"').length, 1);
  assert.equal(findExposedSecret('a.js', 'accessKeyId: "AKIAIOSFODNN7EXAMPLE"').length, 1);
  assert.equal(findExposedSecret('a.js', 'const k = process.env.STRIPE_SECRET').length, 0);
  assert.equal(findExposedSecret('a.js', 'apiKey: "your-api-key-here"').length, 0);
});

test('findOpenCors flags credentialed wildcard/reflect, not a plain public wildcard', () => {
  assert.equal(findOpenCors('s.js', 'cors({ origin: "*", credentials: true })').length, 1);
  assert.equal(findOpenCors('s.js', 'cors({ origin: req.headers.origin, credentials: true })').length, 1);
  assert.equal(findOpenCors('s.js', 'cors({ origin: "*" })').length, 0);
});

test('findMissingRls flags a Supabase table with no RLS, not one that enables it', () => {
  const creates = [
    { table: 'profiles', file: 'supabase/migrations/001.sql', line: 1 },
    { table: 'payments', file: 'supabase/migrations/001.sql', line: 2 }
  ];
  const found = findMissingRls({ supabaseCreates: creates, rlsEnabled: new Set(['profiles']) });
  assert.equal(found.length, 1);
  assert.match(found[0].evidence, /payments/);
});

test('findMissingRls says nothing when there are no supabase creates', () => {
  assert.equal(findMissingRls({ supabaseCreates: [], rlsEnabled: new Set() }).length, 0);
});

test('findMissingRls handles schema-qualified names and does not flag RLS-enabled tables (the menerio 95-FP bug)', async () => {
  const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { auditCodebase } = await import('../src/codebase-audit.js');
  const dir = await mkdtemp(join(tmpdir(), 'rls-'));
  await mkdir(join(dir, 'supabase', 'migrations'), { recursive: true });
  await writeFile(join(dir, 'supabase', 'migrations', '001.sql'),
    'create table public.profiles (id uuid);\n' +
    'alter table public.profiles enable row level security;\n' +           // enabled -> not flagged
    'create table public.payments (id uuid);\n' +                          // public, no RLS -> flagged
    'create schema internal;\ncreate table internal.cron_secret (id int);\n' + // non-public -> not flagged
    '-- create table public.ghost (id uuid) for notes\n');                 // comment -> not flagged
  try {
    const r = await auditCodebase(dir);
    const rls = (r.findings || r).filter((x) => x.kind === 'missing-rls').map((x) => x.evidence);
    assert.equal(rls.length, 1, 'only public.payments should flag');
    assert.match(rls[0], /payments/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('findExposedSecret ignores the Supabase local-dev demo key (public by design)', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const demo = `eyJhbGciOiJIUzI1NiJ9.${b64({ role: 'service_role', iss: 'supabase-demo' })}.${'x'.repeat(43)}`;
  const real = `eyJhbGciOiJIUzI1NiJ9.${b64({ role: 'service_role', ref: 'abcdefghij', iss: 'supabase' })}.${'x'.repeat(43)}`;
  assert.equal(findExposedSecret('scripts/seed.ts', `const k = "${demo}"`).length, 0, 'demo key is not a leak');
  assert.equal(findExposedSecret('scripts/seed.ts', `const k = "${real}"`).length, 1, 'a real project key still fires');
});

test('findSSRF ignores a config-URL template with a request body read nearby (Wegent FP)', () => {
  const wegent = [
    'const backendUrl = getInternalApiUrl()',
    'const r = await fetch(`${backendUrl}/api/chat/cancel`, { method: "POST" })',
    'const body = await request.json()'
  ].join('\n');
  assert.equal(findSSRF('route.ts', wegent).length, 0);
  // and a genuinely request-derived destination still fires
  assert.equal(findSSRF('a.js', 'axios.get(`${req.query.url}/data`)').length, 1);
});
