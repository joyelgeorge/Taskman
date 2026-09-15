import test from 'node:test';
import assert from 'node:assert/strict';
import { extractScriptUrls, scanBundleText, isAnonKeySafe, scanDeployedApp } from '../packages/core/jobs/bundle-scan.js';

/**
 * Research 2026-09-15: scanning DEPLOYED bundles found ~50x the hit rate of
 * scanning GitHub repos (11% of 20,052 URLs vs 4 of 199), and is immune to the
 * GitHub-secret-scanning auto-revocation that is closing the repo surface.
 *
 * The one rule that separates this from a beg-bounty generator: an anon key in
 * a client bundle is EXPECTED and SAFE. Only service_role is a finding. A
 * detector that flags anon keys would be 100% false positive.
 */

const HTML = `
<!doctype html><html><head>
<script src="/_next/static/chunks/main-abc123.js"></script>
<script src="https://cdn.example.com/vendor.js"></script>
<link rel="stylesheet" href="/app.css">
<script src="app.js"></script>
</head></html>`;

test('script URLs are pulled from the page and resolved against its origin', () => {
  const urls = extractScriptUrls(HTML, 'https://myapp.vercel.app/');
  assert.ok(urls.includes('https://myapp.vercel.app/_next/static/chunks/main-abc123.js'));
  assert.ok(urls.includes('https://cdn.example.com/vendor.js'));
  assert.ok(urls.includes('https://myapp.vercel.app/app.js'));
  assert.ok(!urls.some(u => u.endsWith('.css')), 'stylesheets are not scripts');
});

// A real service_role JWT shape (role=service_role, has a project ref).
function serviceRoleJwt() {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const payload = Buffer.from('{"role":"service_role","ref":"abcdefghijklmnop","iss":"supabase"}').toString('base64url');
  return `eyJ${header.slice(3)}.${payload}.c2lnbmF0dXJlc2lnbmF0dXJl`;
}
function anonJwt() {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const payload = Buffer.from('{"role":"anon","ref":"abcdefghijklmnop","iss":"supabase"}').toString('base64url');
  return `eyJ${header.slice(3)}.${payload}.c2lnbmF0dXJlc2lnbmF0dXJl`;
}

test('a service_role key in a bundle is a finding', () => {
  const found = scanBundleText('https://myapp.vercel.app/app.js', `const k="${serviceRoleJwt()}";`);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'exposed-secret');
});

test('an anon key in a bundle is NOT a finding — this is the whole discipline', () => {
  const found = scanBundleText('https://myapp.vercel.app/app.js', `const k="${anonJwt()}";`);
  assert.deepEqual(found, [], 'anon keys are expected in client bundles; flagging them is a beg bounty');
  assert.equal(isAnonKeySafe(), true);
});

test('a bundle with no secret produces nothing', () => {
  assert.deepEqual(scanBundleText('https://x/app.js', 'console.log("hello world");'), []);
});

test('the finding carries the bundle URL, not a local path', () => {
  const found = scanBundleText('https://myapp.vercel.app/_next/static/x.js', `k="${serviceRoleJwt()}"`);
  assert.match(found[0].file, /^https:\/\/myapp\.vercel\.app/);
});

test('scanDeployedApp fetches the page, then each bundle, and reports a real key', async () => {
  const jwt = (() => {
    const h = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
    const p = Buffer.from('{"role":"service_role","ref":"projref1234567890","iss":"supabase"}').toString('base64url');
    return `eyJ${h.slice(3)}.${p}.c2lnc2lnc2ln`;
  })();
  const responses = {
    'https://app.test/': `<script src="/main.js"></script>`,
    'https://app.test/main.js': `const supa="${jwt}";`
  };
  const fetchImpl = async (url) => ({ text: async () => responses[url] ?? '' });

  const result = await scanDeployedApp('https://app.test/', { fetchImpl });
  assert.equal(result.reachable, true);
  assert.equal(result.bundlesScanned, 1);
  assert.equal(result.findings.length, 1);
});

test('scanDeployedApp reports an unreachable app rather than throwing', async () => {
  const fetchImpl = async () => { throw new Error('ENOTFOUND app.test'); };
  const result = await scanDeployedApp('https://app.test/', { fetchImpl });
  assert.equal(result.reachable, false);
  assert.match(result.reason, /ENOTFOUND/);
  assert.deepEqual(result.findings, []);
});

test('one broken bundle does not sink the whole scan', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('bad.js')) throw new Error('500');
    if (url === 'https://app.test/') return { text: async () => `<script src="/bad.js"></script><script src="/ok.js"></script>` };
    return { text: async () => 'clean' };
  };
  const result = await scanDeployedApp('https://app.test/', { fetchImpl });
  assert.equal(result.reachable, true, 'a failed bundle is skipped, not fatal');
});
