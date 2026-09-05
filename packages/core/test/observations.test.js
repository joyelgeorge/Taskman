import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, isAllowedByRules, resetRobotsCache } from '../observations/robots.js';
import { collectSource, extractXmlAttributes } from '../observations/collector.js';
import {
  registerSource, listSources, dueSources, recordObservations, listObservations,
  rollupDay, pruneRawObservations, listRollups, storageStats, resetObservationMemory
} from '../observations/store.js';
import { runDataCollection } from '../observations/runner.js';
import { crossRate, DEFAULT_SOURCES } from '../observations/sources.js';

const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">
  <Cube><Cube time="2026-09-03">
    <Cube currency="USD" rate="1.0850"/>
    <Cube currency="INR" rate="95.4200"/>
    <Cube currency="GBP" rate="0.8410"/>
    <Cube currency="JPY" rate="163.20"/>
  </Cube></Cube>
</gesmes:Envelope>`;

const stubFetch = (body, { status = 200, robots = '' } = {}) => async url => {
  if (String(url).endsWith('/robots.txt')) {
    return { ok: true, status: 200, text: async () => robots };
  }
  return { ok: status >= 200 && status < 300, status, text: async () => body };
};

async function reset() { await resetObservationMemory(); resetRobotsCache(); }

// ---- robots.txt --------------------------------------------------------------

test('a disallowed path is refused, not worked around', async () => {
  await reset();
  await registerSource({
    sourceKey: 's', kind: 'http_xml', url: 'https://example.com/private/feed.xml',
    licence: 'test', decision: 'test',
    config: { tag: 'Cube', keyAttribute: 'currency', valueAttribute: 'rate' }
  });
  const [source] = await listSources();
  const result = await collectSource(source, {
    fetchImpl: stubFetch(ECB_XML, { robots: 'User-agent: *\nDisallow: /private/' })
  });
  assert.equal(result.status, 'REFUSED');
  assert.equal(result.points.length, 0);
  assert.match(result.reason, /robots\.txt/);
});

test('an allowed path collects normally', async () => {
  await reset();
  await registerSource({
    sourceKey: 's', kind: 'http_xml', url: 'https://example.com/public/feed.xml',
    licence: 'test', decision: 'test',
    config: { seriesPrefix: 'fx.eur', tag: 'Cube', keyAttribute: 'currency', valueAttribute: 'rate' }
  });
  const [source] = await listSources();
  const result = await collectSource(source, {
    fetchImpl: stubFetch(ECB_XML, { robots: 'User-agent: *\nDisallow: /private/' })
  });
  assert.equal(result.status, 'OK');
  assert.ok(result.points.length >= 3);
});

test('a rule naming our agent specifically beats the wildcard group', () => {
  const rules = parseRobots(
    'User-agent: *\nDisallow: /\n\nUser-agent: TaskmanDrone\nDisallow: /admin/',
    'TaskmanDrone/1.0'
  );
  assert.equal(isAllowedByRules(rules, '/stats/feed.xml'), true);
  assert.equal(isAllowedByRules(rules, '/admin/panel'), false);
});

test('the longest matching rule wins, and Allow beats Disallow at equal length', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /data/\nAllow: /data/public/');
  assert.equal(isAllowedByRules(rules, '/data/private/x'), false);
  assert.equal(isAllowedByRules(rules, '/data/public/x'), true);
});

test('an empty Disallow value explicitly allows everything', () => {
  const rules = parseRobots('User-agent: *\nDisallow:');
  assert.equal(isAllowedByRules(rules, '/anything'), true);
});

// ---- collection --------------------------------------------------------------

test('XML attributes are extracted into series points, filtered to declared keys', () => {
  const rows = extractXmlAttributes(ECB_XML, 'Cube', ['currency', 'rate']);
  assert.equal(rows.filter(r => r.currency).length, 4);
});

test('a point is dated by when the value was true, not when we fetched it', async () => {
  await reset();
  await registerSource({
    sourceKey: 'ecb', kind: 'http_xml', url: 'https://example.com/feed.xml',
    licence: 'test', decision: 'test',
    config: {
      seriesPrefix: 'fx.eur', tag: 'Cube', keyAttribute: 'currency',
      valueAttribute: 'rate', observedAtPath: 'time', keys: ['USD', 'INR']
    }
  });
  const [source] = await listSources();
  const result = await collectSource(source, { fetchImpl: stubFetch(ECB_XML) });

  assert.equal(result.points.length, 2, 'only the declared keys are kept');
  assert.equal(result.points[0].observedAt.slice(0, 10), '2026-09-03', 'dated from the feed, not from now');
  assert.equal(result.points.find(p => p.seriesKey === 'fx.eur.usd').valueNum, 1.085);
});

test('a network failure is recorded as a finding, never thrown', async () => {
  await reset();
  await registerSource({
    sourceKey: 's', kind: 'http_json', url: 'https://example.com/x.json',
    licence: 'test', decision: 'test', config: {}
  });
  const [source] = await listSources();
  const result = await collectSource(source, {
    fetchImpl: async url => {
      if (String(url).endsWith('/robots.txt')) return { ok: false, status: 404, text: async () => '' };
      throw new Error('ECONNREFUSED');
    }
  });
  assert.equal(result.status, 'FAILED');
  assert.match(result.reason, /ECONNREFUSED/);
});

// ---- the store: licence and decision are mandatory ---------------------------

test('a source without a licence is rejected', async () => {
  await reset();
  await assert.rejects(
    () => registerSource({ sourceKey: 's', kind: 'http_json', url: 'https://x', decision: 'why' }),
    /licence is required/
  );
});

test('a source that names no decision is rejected', async () => {
  await reset();
  await assert.rejects(
    () => registerSource({ sourceKey: 's', kind: 'http_json', url: 'https://x', licence: 'MIT' }),
    /decision is required/
  );
});

// ---- idempotency, rollup, retention ------------------------------------------

test('re-collecting the same point is a no-op, so a double run cannot corrupt a series', async () => {
  await reset();
  await registerSource({ sourceKey: 's', kind: 'http_json', url: 'https://x', licence: 'x', decision: 'x' });
  const point = { seriesKey: 'fx.eur.usd', valueNum: 1.085, payload: {}, observedAt: '2026-09-03T00:00:00.000Z' };

  const first = await recordObservations('s', [point]);
  const second = await recordObservations('s', [point]);
  assert.equal(first.inserted, 1);
  assert.equal(second.inserted, 0);
  assert.equal(second.duplicates, 1);
});

test('a day rolls up into one row per series with min, max, avg and last', async () => {
  await reset();
  await registerSource({ sourceKey: 's', kind: 'http_json', url: 'https://x', licence: 'x', decision: 'x' });
  await recordObservations('s', [
    { seriesKey: 'fx.eur.usd', valueNum: 1.08, payload: {}, observedAt: '2026-09-03T01:00:00.000Z' },
    { seriesKey: 'fx.eur.usd', valueNum: 1.10, payload: {}, observedAt: '2026-09-03T09:00:00.000Z' },
    { seriesKey: 'fx.eur.usd', valueNum: 1.09, payload: {}, observedAt: '2026-09-03T17:00:00.000Z' }
  ]);

  await rollupDay({ date: '2026-09-03' });
  const [rollup] = await listRollups({ seriesKey: 'fx.eur.usd' });
  assert.equal(rollup.sampleCount, 3);
  assert.equal(rollup.valueMin, 1.08);
  assert.equal(rollup.valueMax, 1.10);
  assert.equal(rollup.valueLast, 1.09, 'last is the latest by observation time, not insertion order');
});

test('pruning removes raw rows past retention but never touches the rollup', async () => {
  await reset();
  await registerSource({ sourceKey: 's', kind: 'http_json', url: 'https://x', licence: 'x', decision: 'x' });
  const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
  const recent = new Date().toISOString();
  await recordObservations('s', [
    { seriesKey: 'fx.eur.usd', valueNum: 1.0, payload: {}, observedAt: old },
    { seriesKey: 'fx.eur.usd', valueNum: 1.1, payload: {}, observedAt: recent }
  ]);
  await rollupDay({ date: old });

  const prune = await pruneRawObservations({ retentionDays: 90 });
  assert.equal(prune.removed, 1);
  assert.equal((await listObservations({})).length, 1, 'the recent raw row survives');
  assert.equal((await listRollups({})).length, 1, 'the rollup of the pruned day is untouched — it is the asset');
});

test('storage stats expose growth before it becomes a problem', async () => {
  await reset();
  const stats = await storageStats();
  assert.equal(stats.rawObservations, 0);
  assert.equal(stats.retentionDays, 90);
});

// ---- derived rates -----------------------------------------------------------

test('USD to INR is derived from the two EUR-based rates', () => {
  // ECB quotes EUR→USD 1.085 and EUR→INR 95.42, so USD→INR is 95.42/1.085.
  assert.equal(crossRate({ fromRatePerEur: 1.085, toRatePerEur: 95.42 }), 87.9447);
});

test('a cross rate with a zero or missing leg is null, not a wrong number', () => {
  assert.equal(crossRate({ fromRatePerEur: 0, toRatePerEur: 95 }), null);
  assert.equal(crossRate({ fromRatePerEur: 1.08, toRatePerEur: undefined }), null);
});

// ---- the runner --------------------------------------------------------------

test('a full run collects, rolls up, prunes, and seeds the declared source once', async () => {
  await reset();
  const testNow = new Date('2026-09-03T12:00:00Z');
  const result = await runDataCollection({ fetchImpl: stubFetch(ECB_XML), now: testNow });

  // Enabled sources only. A declared-but-disabled source stays in the file so its
  // disproof travels with it — the HN ranking series is kept and switched off
  // rather than deleted — but it is not collected.
  assert.equal(result.collected, DEFAULT_SOURCES.filter(s => s.enabled !== false).length);
  assert.equal(result.ok, 1);
  assert.ok(result.newPoints >= 3);
  assert.ok(result.rollup.seriesRolled >= 1);
  const sources = await listSources();
  const ecb = sources.find(s => s.sourceKey === 'ecb-euro-reference-rates');
  assert.ok(ecb, 'ecb-euro-reference-rates source is seeded');
});

test('a source is not collected again before its interval has elapsed', async () => {
  await reset();
  const testNow = new Date('2026-09-03T12:00:00Z');
  await runDataCollection({ fetchImpl: stubFetch(ECB_XML), now: testNow });
  const second = await runDataCollection({ fetchImpl: stubFetch(ECB_XML), now: testNow });
  assert.equal(second.collected, 0, 'daily source, same run — nothing is due');
  assert.equal((await dueSources({ now: testNow })).length, 0);
});

// ---- robots wildcards --------------------------------------------------------

test('an Allow with a wildcard and an end anchor beats a blanket Disallow', () => {
  // Hacker News publishes exactly this, permitting the endpoints its API
  // documents. Treating `/*.json$` as a literal prefix matched nothing, so
  // `Disallow: /` won and the collector refused a source the publisher had gone
  // out of its way to allow.
  const rules = parseRobots('User-agent: *\nAllow: /*.json$\nAllow: /*.json?*$\nDisallow: /');
  assert.equal(isAllowedByRules(rules, '/v0/topstories.json'), true);
  assert.equal(isAllowedByRules(rules, '/v0/item/123.json'), true);
  assert.equal(isAllowedByRules(rules, '/v0/user/pg'), false, 'the blanket Disallow still governs everything else');
});

test('an end anchor really anchors', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /\nAllow: /ok$');
  assert.equal(isAllowedByRules(rules, '/ok'), true);
  assert.equal(isAllowedByRules(rules, '/ok/more'), false);
});

test('a plain rule with no wildcard is still a prefix match', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /private/');
  assert.equal(isAllowedByRules(rules, '/private/x'), false);
  assert.equal(isAllowedByRules(rules, '/public/x'), true);
});

test('a newly declared source reaches an install that already has others', async () => {
  await reset();
  // Seeding only into an empty store meant adding a source to DEFAULT_SOURCES
  // was a no-op everywhere it was already running — the exact way the ephemeral
  // ranking series shipped and then silently collected nothing.
  await registerSource({
    sourceKey: 'pre-existing', kind: 'http_json', url: 'https://example.test/a.json',
    licence: 'test', decision: 'test'
  });
  await runDataCollection({ fetchImpl: stubFetch(ECB_XML), now: new Date('2026-09-03T12:00:00Z') });
  const keys = (await listSources()).map(s => s.sourceKey);
  for (const declared of DEFAULT_SOURCES) {
    assert.ok(keys.includes(declared.sourceKey), `${declared.sourceKey} should have been seeded alongside the existing source`);
  }
});
