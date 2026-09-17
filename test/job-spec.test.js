import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_STAGE, DISTRIBUTION, assertValidJob, isRunnableJob
} from '../packages/core/jobs/job-spec.js';
import { EXPLORED_TERRITORIES } from '../packages/core/territory/registry.js';
import { DIMENSIONS, scoreTerritory } from '../packages/core/territory/scoring.js';

const base = {
  key: 'a-job', verdict: 'unproven', note: 'a note long enough to say why it is here',
  distribution: DISTRIBUTION.RELATIONSHIP_EXISTS
};

test('a descriptor with no stages is a territory, not a runnable job', () => {
  assertValidJob(base);
  assert.equal(isRunnableJob(base), false);
});

test('a job that can charge but cannot verify is refused', () => {
  // The structural rule: money may not be taken for an outcome nothing checked.
  assert.throws(
    () => assertValidJob({ ...base, stages: { detect: () => {}, charge: () => {} } }),
    /verify/i
  );
});

test('a job that verifies before charging is accepted', () => {
  const job = { ...base, stages: { detect: () => {}, verify: () => {}, charge: () => {} } };

  assertValidJob(job);
  assert.equal(isRunnableJob(job), true);
});

test('a stage name the runner does not know is refused rather than ignored', () => {
  assert.throws(
    () => assertValidJob({ ...base, stages: { detect: () => {}, profit: () => {} } }),
    /profit/
  );
});

test('a stage that is not callable is refused', () => {
  assert.throws(() => assertValidJob({ ...base, stages: { detect: 'soon' } }), /callable/i);
});

test('a distribution label the scorer cannot score is refused', () => {
  assert.throws(() => assertValidJob({ ...base, distribution: 'word of mouth' }), /distribution/i);
});

test('every distribution label the spec allows is one the scorer can score', () => {
  for (const label of Object.values(DISTRIBUTION)) {
    assert.ok(label in DIMENSIONS.distribution.values, `scorer cannot score "${label}"`);
  }
});

test('every stage the spec names is unique and lower case', () => {
  const names = Object.values(JOB_STAGE);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.equal(n, n.toLowerCase());
});

// The registry is the single list. If an entry cannot describe itself, that is a
// finding, not something to discover later at execution time.
test('every registry entry is a valid descriptor', () => {
  for (const entry of EXPLORED_TERRITORIES) {
    assert.doesNotThrow(() => assertValidJob(entry), `${entry.key} is not a valid descriptor`);
  }
});

test('the real registry ranks the warm lane above the cold scan lane', () => {
  const find = (k) => EXPLORED_TERRITORIES.find(t => t.key === k);
  const tally = find('tally-smb-leakage-audit');
  const scan = find('oss-vuln-sweep');
  assert.ok(tally && scan, 'both lanes must exist in the registry');

  const s = (e) => scoreTerritory({ scores: { ...(e.scores || {}), distribution: e.distribution } }).score;
  assert.ok(s(tally) > s(scan),
    `tally (${s(tally)}) must outrank the cold lane (${s(scan)}) on declared distribution alone`);
});
