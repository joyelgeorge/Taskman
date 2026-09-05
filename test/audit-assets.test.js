import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_ASSETS, readPair } from '../scripts/sync-audit-assets.js';

test('the static audit page serves the same modules the tests cover', async () => {
  // The public page runs the audit in the browser so the files never leave the
  // user's machine. That means shipping a copy of the real modules — and a copy
  // that drifts from the original is a page quietly running untested code
  // against someone's bank export. Run `npm run sync:audit` when this fails.
  for (const name of AUDIT_ASSETS) {
    const { source, copy } = await readPair(name);
    assert.ok(copy !== null, `packages/web/public/audit/${name} is missing — run npm run sync:audit`);
    assert.equal(copy, source, `${name} has drifted from src/ — run npm run sync:audit`);
  }
});
