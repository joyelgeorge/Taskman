import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildScanReport, prepareScanOrder, fulfilScanOrder, SCAN_TIERS } from '../src/scan-fulfilment.js';

function svcJwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${b64({ role: 'service_role' })}.${'x'.repeat(43)}`;
}
async function vulnerableApp() {
  const dir = await mkdtemp(join(tmpdir(), 'scanfx-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, 'supabase', 'migrations'), { recursive: true });
  await writeFile(join(dir, 'src', 'c.ts'), `createClient(url, "${svcJwt()}")`);
  await writeFile(join(dir, 'supabase', 'migrations', '001.sql'), 'CREATE TABLE messages (id uuid);');
  return dir;
}

test('buildScanReport counts critical vs high and lists only sellable classes', () => {
  const r = buildScanReport([
    { kind: 'exposed-secret', file: 'a', line: 1, evidence: 'e', why: 'w', confirm: 'c' },
    { kind: 'open-cors', file: 'b', line: 2, evidence: 'e', why: 'w', confirm: 'c' },
    { kind: 'silent-fallback', file: 'x', line: 9, evidence: 'e', why: 'w', confirm: 'c' } // not sellable
  ]);
  assert.equal(r.summary.total, 2);
  assert.equal(r.summary.critical, 1);
  assert.equal(r.summary.high, 1);
});

test('prepareScanOrder produces a report + PayPal link and books nothing', async () => {
  const dir = await vulnerableApp();
  try {
    const order = await prepareScanOrder({ root: dir, tier: 'scan' });
    assert.equal(order.priceCents, SCAN_TIERS.scan.priceCents);
    assert.ok(order.report.summary.total >= 2);
    assert.match(order.payment.link, /paypal\.me\/joyelgt/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('fulfilScanOrder refuses an unverifiable payment and a missing reference', async () => {
  const dir = await vulnerableApp();
  try {
    await assert.rejects(fulfilScanOrder({ root: dir, source: 'promise', externalRef: 'x', grossCents: 9900, minutesSpent: 30 }));
    await assert.rejects(fulfilScanOrder({ root: dir, source: 'paypal', grossCents: 9900, minutesSpent: 30 }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('fulfilScanOrder books a verified PayPal payment as revenue', async () => {
  const dir = await vulnerableApp();
  try {
    const done = await fulfilScanOrder({
      root: dir, tier: 'scan', source: 'paypal',
      externalRef: 'PAYPAL-TEST-' + Date.now(), grossCents: 9900, feeCents: 400, minutesSpent: 30
    });
    assert.equal(done.settlement.source, 'paypal');
    assert.equal(done.economics.netCents, 9500);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
