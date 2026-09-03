import test from 'node:test';
import assert from 'node:assert/strict';
import { scanTarget } from '../scans/prober.js';
import {
  registerTarget, listTargets, setTargetEnabled, recordScan, latestScans, scanHistory, resetScanMemory
} from '../scans/store.js';
import { runSatelliteScan } from '../scans/runner.js';
import { DEFAULT_TARGETS } from '../scans/targets.js';

const html = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const stub = (body, { status = 200, ok = status >= 200 && status < 300 } = {}) =>
  async () => ({ status, ok, text: async () => body });

function reset() { resetScanMemory(); }

// ---- signature detection, against the exact pages hit by hand -------------

test('the real Cloudflare "verify you are human" page Upwork served is detected as bot-defended', async () => {
  const body = html('Just a moment...', 'Verify you are human by completing the action below. Cloudflare Ray ID: a34eb8dc8dde7887');
  const result = await scanTarget({ targetKey: 'upwork', targetUrl: 'https://upwork.com', fetchImpl: stub(body) });
  assert.equal(result.reachable, true);
  assert.equal(result.botDefended, true);
  assert.equal(result.botDefenseVendor, 'cloudflare');
  assert.equal(result.shape, 'unknown', 'a blocked page never gets a shape guess');
});

test('the real PerimeterX "needs a human touch" page Fiverr served is detected as bot-defended', async () => {
  const body = html('It needs a human touch', 'ERRCODE PXCR10002539. Request details: ip 103.151.188.21');
  const result = await scanTarget({ targetKey: 'fiverr', targetUrl: 'https://fiverr.com', fetchImpl: stub(body) });
  assert.equal(result.botDefended, true);
  assert.equal(result.botDefenseVendor, 'perimeterx');
});

test('a 403 with no recognizable body text still reads as bot-defended from the status alone', async () => {
  const result = await scanTarget({
    targetKey: 'blocked', targetUrl: 'https://example.com',
    fetchImpl: stub('forbidden', { status: 403 })
  });
  assert.equal(result.reachable, true, 'an HTTP error is a response, not an unreachable target');
  assert.equal(result.botDefended, true);
  assert.equal(result.botDefenseVendor, null, 'no signature matched — only the status code was suggestive');
  assert.match(result.verdict, /HTTP 403/);
});

test('a genuine network failure is reported as unreachable, not bot-defended', async () => {
  const failing = async () => { throw new Error('ENOTFOUND example.invalid'); };
  const result = await scanTarget({ targetKey: 'dead', targetUrl: 'https://example.invalid', fetchImpl: failing });
  assert.equal(result.reachable, false);
  assert.equal(result.botDefended, false);
  assert.match(result.verdict, /unreachable/);
});

// ---- shape classification ---------------------------------------------------

test('the real California unclaimed-property page classifies as single_lookup', async () => {
  const body = html('California Unclaimed Property', `
    We have returned more than $8,453,448,852.
    Begin your search below. Last Name or Business Name. First Name (Optional). Search.
    ${'padding '.repeat(60)}
  `);
  const result = await scanTarget({ targetKey: 'ca-unclaimed', targetUrl: 'https://ucpi.sco.ca.gov/', fetchImpl: stub(body) });
  assert.equal(result.botDefended, false);
  assert.equal(result.shape, 'single_lookup');
  assert.ok(result.shapeConfidence > 0);
});

test('a job-board-shaped page classifies as job_board', async () => {
  const body = html('Find work', `
    Post a job and browse jobs from clients ready to hire freelancers.
    Submit a proposal to apply now. ${'padding '.repeat(60)}
  `);
  const result = await scanTarget({ targetKey: 'jobs', targetUrl: 'https://example.com/jobs', fetchImpl: stub(body) });
  assert.equal(result.shape, 'job_board');
});

test('a catalog-shaped page classifies as catalog', async () => {
  const body = html('Gigs', `
    Browse gigs starting at $5. Add to cart or buy now. Delivery time and seller level shown per gig.
    ${'padding '.repeat(60)}
  `);
  const result = await scanTarget({ targetKey: 'catalog', targetUrl: 'https://example.com/gigs', fetchImpl: stub(body) });
  assert.equal(result.shape, 'catalog');
});

test('one incidental keyword is not enough evidence to assert a shape', async () => {
  const body = html('Homepage', `A gig economy article. ${'padding '.repeat(60)}`);
  const result = await scanTarget({ targetKey: 'thin', targetUrl: 'https://example.com', fetchImpl: stub(body) });
  assert.equal(result.shape, 'unknown');
});

test('a near-empty JS-shell response is reported as undetermined, not guessed', async () => {
  const result = await scanTarget({
    targetKey: 'spa', targetUrl: 'https://example.com',
    fetchImpl: stub('<html><body><div id="root"></div></body></html>')
  });
  assert.equal(result.botDefended, false);
  assert.equal(result.shape, 'unknown');
  assert.match(result.verdict, /JS-rendered shell/);
});

// ---- store -------------------------------------------------------------------

test('registering a target twice upserts rather than duplicating', async () => {
  reset();
  await registerTarget({ targetKey: 't1', targetUrl: 'https://a.example' });
  await registerTarget({ targetKey: 't1', targetUrl: 'https://b.example' });
  const targets = await listTargets();
  assert.equal(targets.length, 1);
  assert.equal(targets[0].targetUrl, 'https://b.example');
});

test('scans are append-only; latestScans reports only the most recent per target', async () => {
  reset();
  await recordScan({ targetKey: 't1', targetUrl: 'https://a.example', reachable: true, verdict: 'first', scannedAt: '2026-01-01T00:00:00.000Z' });
  await recordScan({ targetKey: 't1', targetUrl: 'https://a.example', reachable: true, verdict: 'second', scannedAt: '2026-01-02T00:00:00.000Z' });

  const latest = await latestScans();
  assert.equal(latest.length, 1);
  assert.equal(latest[0].verdict, 'second');

  const history = await scanHistory('t1');
  assert.equal(history.length, 2, 'history keeps every scan, not just the latest');
});

test('a disabled target is skipped by the next run', async () => {
  reset();
  await registerTarget({ targetKey: 't1', targetUrl: 'https://a.example' });
  await setTargetEnabled('t1', false);
  const enabled = await listTargets({ enabledOnly: true });
  assert.equal(enabled.length, 0);
});

// ---- runner / cron -------------------------------------------------------------

test('runSatelliteScan seeds the three hand-checked venues on a fresh install', async () => {
  reset();
  const result = await runSatelliteScan({ fetchImpl: stub(html('x', 'x'.repeat(500))) });
  assert.equal(result.scanned, DEFAULT_TARGETS.length);
  const targets = await listTargets();
  assert.deepEqual(targets.map(t => t.targetKey).sort(), DEFAULT_TARGETS.map(t => t.targetKey).sort());
});

test('runSatelliteScan does not re-seed once targets already exist', async () => {
  reset();
  await registerTarget({ targetKey: 'only-one', targetUrl: 'https://a.example' });
  const result = await runSatelliteScan({ fetchImpl: stub(html('x', 'x'.repeat(500))) });
  assert.equal(result.scanned, 1);
});
