/**
 * The position, reconstructed rather than recalled.
 *
 * A session starts here. It reads every store that can answer, labels every row
 * with how that store answered, and refuses to print a number it cannot stand
 * behind. `scripts/preflight.js` validates configuration; this reports where the
 * project actually stands.
 *
 * The exit code is the load-bearing part. A brief that could not reach a store
 * exits non-zero, so an incomplete position cannot be mistaken for a complete
 * one by anything reading it — a human, a script, or a model.
 */

import { STORE_STATE, readStore, anyUnknown } from './store-state.js';

export async function buildBrief({ readers = [], now = new Date() } = {}) {
  const rows = [];
  for (const reader of readers) rows.push(await readStore(reader));

  const complete = !anyUnknown(rows);
  return { rows, complete, exitCode: complete ? 0 : 1, at: now.toISOString() };
}

const WIDTH = 26;

function renderRow(row) {
  const label = String(row.label).padEnd(WIDTH);
  if (row.state === STORE_STATE.UNKNOWN) {
    return `${label}UNKNOWN   ${row.reason}`;
  }
  return `${label}${row.state.padEnd(10)}${row.count}`;
}

export function renderBrief(brief) {
  const lines = [
    `Taskman position at ${brief.at}`,
    ''.padEnd(60, '-'),
    ...brief.rows.map(renderRow)
  ];

  if (!brief.complete) {
    lines.push(
      ''.padEnd(60, '-'),
      'This position is incomplete. Rows marked UNKNOWN were not read, and a',
      'zero was not substituted for any of them. Do not quote a number this',
      'brief did not print.'
    );
  }
  return lines.join('\n');
}
