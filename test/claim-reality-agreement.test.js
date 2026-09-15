import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { databaseEnabled, query } from '../src/db.js';

/**
 * The numbers and names our own documents assert, checked against the thing they
 * are claims about.
 *
 * test/schema-code-agreement.test.js already does this for the database schema.
 * This does it for the documents a session is told to trust before it writes
 * anything, because READ-FIRST.md makes the argument against itself:
 *
 *   "a read-first document that has drifted is worse than none, because it is
 *    trusted."
 *
 * A document nobody checks decays into a document that lies, and the decay is
 * invisible while it happens. The "71 critical findings" headline that turned
 * out to be one systemic issue counted seventy times was caught by hand, once,
 * by luck.
 *
 * Each assertion must reach the PRIMARY source — the filesystem, the database,
 * package.json. A test that recomputes a number from the same place the document
 * copied it from proves nothing.
 */

const DOCS = ['docs/READ-FIRST.md', 'CLAUDE.md'];

const read = (p) => readFile(p, 'utf8');

test('every settlement path READ-FIRST names is real, and it names all of them', async () => {
  const text = await read('docs/READ-FIRST.md');

  // What the document claims.
  const claimed = new Set(
    [...text.matchAll(/`([a-z-]+(?:\/[a-z-]+)?)`/g)]
      .map(m => m[1])
      .filter(name => /^(audit-fulfilment|scan-fulfilment|workers\/execute|autonomous-engine|orders|settlement-verifier|runner)$/.test(name))
  );

  // What the code does. money-ledger defines recordSettlement rather than being
  // a path to it; scripts/ are one-off operator tools, not production paths.
  const actual = new Set();
  for (const dir of ['src', 'src/workers', 'packages/core', 'packages/core/jobs', 'packages/core/orders']) {
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.js') || f === 'money-ledger.js') continue;
      const body = await readFile(`${dir}/${f}`, 'utf8');
      // A re-export is not a path to the ledger, it is a second name for it.
      // packages/core/ledger.js exists precisely so there is ONE implementation,
      // and counting it would turn that discipline into a phantom seventh path.
      const withoutReExports = body.replace(/export\s*\{[^}]*\}/gs, '');
      if (!withoutReExports.includes('recordSettlement')) continue;
      const base = f.replace(/\.js$/, '');
      actual.add(dir === 'src/workers' ? `workers/${base}`
        : base === 'index' ? dir.split('/').pop()
        : base);
    }
  }

  const missing = [...actual].filter(p => !claimed.has(p)).sort();
  const phantom = [...claimed].filter(p => !actual.has(p)).sort();

  assert.deepEqual(missing, [], `READ-FIRST does not name these settlement paths: ${missing.join(', ')}`);
  assert.deepEqual(phantom, [], `READ-FIRST names settlement paths that no longer exist: ${phantom.join(', ')}`);
});

test('the count READ-FIRST states matches the paths it lists', async () => {
  const text = await read('docs/READ-FIRST.md');
  const stated = /\*\*(\w+) code paths can record a settlement\*\*/.exec(text);
  assert.ok(stated, 'READ-FIRST no longer states a settlement-path count in the expected form');

  const words = { Four: 4, Five: 5, Six: 6, Seven: 7, Eight: 8, Nine: 9, Ten: 10 };
  const claimedCount = words[stated[1]];
  assert.ok(claimedCount, `"${stated[1]}" is not a number this test can read`);

  const listed = /can record a settlement\*\* — ([\s\S]*?)\. The machinery/.exec(text);
  assert.ok(listed, 'the list of paths is no longer in the expected form');
  const names = [...listed[1].matchAll(/`[^`]+`/g)].length;

  assert.equal(names, claimedCount, `READ-FIRST says ${claimedCount} paths and lists ${names}`);
});

test('every file our trusted docs point at actually exists', async () => {
  const broken = [];
  for (const doc of DOCS) {
    const text = await read(doc);
    for (const m of text.matchAll(/`([\w.@-]+(?:\/[\w.@-]+)+\.(?:js|mjs|sql|md|json|yml))`/g)) {
      if (!existsSync(m[1])) broken.push(`${doc} -> ${m[1]}`);
    }
  }
  assert.deepEqual(broken, [], `documents point at files that do not exist:\n${broken.join('\n')}`);
});

test('every npm script our trusted docs tell a session to run exists', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const missing = [];
  for (const doc of DOCS) {
    for (const m of (await read(doc)).matchAll(/npm run ([\w:-]+)/g)) {
      if (!pkg.scripts[m[1]]) missing.push(`${doc} -> npm run ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], `documents name npm scripts that do not exist:\n${missing.join('\n')}`);
});

test('the test count CLAUDE.md advertises is not badly stale', async () => {
  const text = await read('CLAUDE.md');
  const stated = /Run unit test suite \((\d+) tests as of/.exec(text);
  assert.ok(stated, 'CLAUDE.md no longer advertises a test count in the expected form');

  // Primary source: the test files themselves, not a remembered number.
  let actual = 0;
  for (const f of await readdir('test')) {
    if (!f.endsWith('.test.js')) continue;
    actual += [...(await readFile(`test/${f}`, 'utf8')).matchAll(/^\s*test\(/gm)].length;
  }

  // `npm test` counts subtests inside suites; this counts top-level test()
  // calls, so the two differ by design and the tolerance spans that gap rather
  // than pretending the metrics are the same measurement.
  const claimed = Number(stated[1]);
  assert.ok(Math.abs(claimed - actual) < 300,
    `CLAUDE.md advertises ${claimed} tests and the files hold ${actual} top-level test() calls — `
    + 'far enough apart to mislead a session about how covered this repo is; update the number');
});

/**
 * CI runs the suite against an ephemeral `taskman_test` container, which is
 * empty because it was created thirty seconds ago — not because the project has
 * no revenue. Letting that stand as proof would be the exact confusion
 * src/store-state.js exists to end: "empty because nothing is there" read as
 * "empty, verified".
 *
 * So this is opt-in and points at the real ledger:
 *
 *   TASKMAN_VERIFY_LEDGER=1 DATABASE_URL=<the production url> npm test
 */
const ledgerCheck = process.env.TASKMAN_VERIFY_LEDGER === '1' && databaseEnabled;

test('settlements is empty, exactly as every document in this repo asserts', {
  skip: ledgerCheck ? false
    : 'opt-in: set TASKMAN_VERIFY_LEDGER=1 against the REAL ledger. A throwaway '
      + 'CI database is empty by construction and answers nothing.'
}, async () => {
  const { rows } = await query('SELECT count(*)::int AS n FROM settlements');

  // The happiest failure this repository could have. When it goes red, money has
  // arrived: update READ-FIRST and docs/WHY-NO-MONEY-YET.md in the same commit,
  // and delete this assertion rather than weakening it.
  assert.equal(rows[0].n, 0,
    `settlements has ${rows[0].n} row(s). If that is real revenue, the docs are now wrong — fix them.`);
});
