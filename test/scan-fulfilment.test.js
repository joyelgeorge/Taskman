import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildScanReport, prepareScanOrder, fulfilScanOrder, SCAN_TIERS } from '../src/scan-fulfilment.js';

function svcJwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${b64({ role: 'service_role', ref: 'abcdefghij', iss: 'supabase' })}.${'x'.repeat(43)}`;
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

test('an unreachable injection never reaches the customer report', () => {
  // The flyrpro case: four of these were reported CRITICAL and none was real.
  const r = buildScanReport([
    { kind: 'exposed-secret', file: 'src/client.js', line: 1, evidence: 'e', why: 'w', confirm: 'c' },
    {
      kind: 'command-injection', file: 'scripts/import.js', line: 12,
      evidence: 'exec(`node load.js ${process.env.TOKEN}`)', why: 'w', confirm: 'c'
    }
  ]);
  assert.equal(r.summary.total, 1, 'the refuted injection is not counted');
  assert.equal(r.summary.refuted, 1);
  assert.doesNotMatch(r.markdown.split('## Checked and dismissed')[0], /command-injection/,
    'it must not appear among the findings being charged for');
  assert.match(r.markdown, /Checked and dismissed \(1\)/,
    'but it is shown — a report that quietly drops a finding is unauditable');
});

test('the report never leads with a raw finding count', () => {
  const rls = (i) => ({
    kind: 'missing-rls', file: `db/schema-${i % 3}.sql`, line: i,
    evidence: 'e', why: 'w', confirm: 'c'
  });
  const r = buildScanReport(Array.from({ length: 30 }, (_, i) => rls(i)));
  assert.equal(r.summary.rawFindings, 30);
  assert.equal(r.summary.problems, 3, '30 findings across 3 files is 3 problems');
  assert.match(r.markdown, /3 problems across 3 files/);
  assert.match(r.markdown, /overstates the work by 10x/);
});

test('a request-tainted injection on a request path is still charged for', () => {
  const r = buildScanReport([{
    kind: 'command-injection', file: 'src/api/convert.js', line: 8,
    evidence: 'exec(`convert ${req.query.name}`)', why: 'w', confirm: 'c'
  }]);
  assert.equal(r.summary.total, 1, 'refutation must discriminate, not deflate');
  assert.equal(r.summary.refuted, 0);
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
      externalRef: 'PAYPAL-TEST-' + Date.now(), grossCents: 9900, feeCents: 400, minutesSpent: 30,
      confirmation: { method: 'operator_receipt', observedAt: '2026-09-01T00:00:00.000Z' }
    });
    assert.equal(done.settlement.source, 'paypal');
    assert.equal(done.economics.netCents, 9500);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
