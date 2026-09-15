import test from 'node:test';
import assert from 'node:assert/strict';
import { scanDeployedApps, toBundleLeadResult } from '../packages/core/jobs/bundle-scan.js';

/**
 * The deployed-bundle surface has ~50x the yield of GitHub repos and the repo
 * surface is tapped. This makes the scanner runnable over a list of URLs and
 * shaped for the existing lead store, so it is a lead source, not a lone
 * function.
 */

const jwt = (role) => {
  const h = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const p = Buffer.from(`{"role":"${role}","ref":"projref1234567890","iss":"supabase"}`).toString('base64url');
  return `eyJ${h.slice(3)}.${p}.c2lnc2lnc2ln`;
};

function fakeFetch(map) {
  return async (url) => ({ text: async () => map[url] ?? '' });
}

test('scanning a list yields one result per reachable app', async () => {
  const map = {
    'https://a.app/': '<script src="/a.js"></script>',
    'https://a.app/a.js': `k="${jwt('service_role')}"`,
    'https://b.app/': '<script src="/b.js"></script>',
    'https://b.app/b.js': 'clean'
  };
  const results = await scanDeployedApps(['https://a.app/', 'https://b.app/'], { fetchImpl: fakeFetch(map) });

  assert.equal(results.length, 2);
  assert.equal(results.find(r => r.app === 'https://a.app/').findings.length, 1);
  assert.equal(results.find(r => r.app === 'https://b.app/').findings.length, 0);
});

test('a bundle result is shaped into the lead-store record, keyed on the app URL', () => {
  const lead = toBundleLeadResult({ app: 'https://shop.app/', findings: [{ kind: 'exposed-secret', file: 'https://shop.app/x.js' }] });

  assert.equal(lead.repo, 'https://shop.app/', 'the app URL is the dedupe key, in the repo slot');
  assert.equal(lead.findings.length, 1);
  assert.equal(lead.meta.homepage, 'https://shop.app/', 'the deployed URL is itself the homepage signal');
});

test('an app with no findings shapes to null so it is not stored as a lead', () => {
  assert.equal(toBundleLeadResult({ app: 'https://clean.app/', findings: [] }), null);
});

test('an unreachable app does not become a lead', async () => {
  const results = await scanDeployedApps(['https://dead.app/'], {
    fetchImpl: async () => { throw new Error('ENOTFOUND'); }
  });
  assert.equal(results[0].reachable, false);
  assert.equal(toBundleLeadResult(results[0]), null);
});
