import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessReachability, refuteUnreachable, classifyLocation, classifyTaint,
  LOCATION, TAINT
} from '../packages/core/findings/reachability.js';

/**
 * The flyrpro case, verbatim in shape: a shell call assembled from a template
 * literal interpolating an environment variable, inside a local script. Four of
 * these were reported as CRITICAL. None was reachable by any request.
 */
const flyrproFinding = (i = 0) => ({
  kind: 'command-injection',
  file: 'scripts/import-data.js',
  line: 12 + i,
  evidence: 'exec(`node ./bin/load.js --token=${process.env.API_TOKEN}`)'
});

test('the four findings that started this are refuted', () => {
  const { reportable, contested, refuted } = refuteUnreachable(
    [0, 1, 2, 3].map(flyrproFinding)
  );
  assert.equal(refuted.length, 4);
  assert.equal(reportable.length, 0, 'none of these may be counted or shown');
  assert.equal(contested.length, 0, 'both signals agree, so no human time is spent');
  assert.match(refuted[0].reachability.reason, /environment value inside tooling/);
});

test('the same sink on a request path with request data still stands', () => {
  const finding = {
    kind: 'command-injection',
    file: 'src/api/convert.js',
    line: 8,
    evidence: 'exec(`convert ${req.query.filename} out.png`)'
  };
  const a = assessReachability(finding);
  assert.equal(a.verdict, 'stands');
  assert.equal(a.location, LOCATION.REQUEST);
  assert.equal(a.taint, TAINT.REQUEST);
});

test('request data inside a script is contested, not refuted', () => {
  // The expensive mistake would be dismissing this because of the folder.
  const a = assessReachability({
    kind: 'command-injection',
    file: 'scripts/webhook-handler.js',
    line: 3,
    evidence: 'exec(`process ${req.body.path}`)'
  });
  assert.equal(a.verdict, 'contested', 'a folder name must not overrule attacker-settable input');
  assert.match(a.reason, /read it before believing either signal/);
});

test('an environment value on a request path is contested, not waved through', () => {
  const a = assessReachability({
    kind: 'command-injection',
    file: 'src/api/report.js',
    line: 5,
    evidence: 'exec(`gen --dir=${process.env.OUT}`)'
  });
  assert.equal(a.verdict, 'contested');
});

test('a route defined inline beats the folder it lives in', () => {
  const handlerBody = 'export async function POST(request) { const b = await request.json(); }';
  assert.equal(classifyLocation('src/lib/thing.js', handlerBody), LOCATION.REQUEST,
    'a handler is a handler wherever it sits');
  assert.equal(classifyLocation('src/lib/thing.js', ''), LOCATION.UNKNOWN);
});

test('kinds that do not depend on reachability are never refuted by it', () => {
  for (const kind of ['exposed-secret', 'missing-rls', 'unauthenticated-admin-route', 'open-cors']) {
    const a = assessReachability({ kind, file: 'scripts/seed.js', evidence: 'process.env.KEY' });
    assert.equal(a.verdict, 'stands',
      `${kind} in a script is still ${kind} — a leaked key in tooling is still leaked`);
  }
});

test('when neither signal speaks, it is contested rather than assumed either way', () => {
  const a = assessReachability({
    kind: 'ssrf', file: 'src/util/fetcher.js', line: 2, evidence: 'fetch(`${base}/x`)'
  });
  assert.equal(a.verdict, 'contested');
  assert.equal(a.location, LOCATION.UNKNOWN);
  assert.equal(a.taint, TAINT.UNKNOWN);
});

test('refuted findings are kept, not silently dropped', () => {
  const { refuted } = refuteUnreachable([flyrproFinding()]);
  assert.equal(refuted.length, 1, 'a disclosure that loses a finding is as unauditable as one that invents it');
  assert.ok(refuted[0].reachability.reason);
});

test('taint classification prefers request over environment when both appear', () => {
  assert.equal(
    classifyTaint('exec(`run ${process.env.BIN} ${req.query.arg}`)'),
    TAINT.REQUEST,
    'under-calling attacker-settable input is the expensive direction'
  );
});
