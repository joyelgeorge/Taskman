#!/usr/bin/env node
/**
 * The place to type when a message has actually been sent.
 *
 *   npm run outreach -- log --lane=audit --channel=r/Fiverr --prospect=u/name [--note="..."]
 *   npm run outreach -- outcome <id> REPLIED|DECLINED|INTERESTED|PAID|NO_RESPONSE
 *   npm run outreach -- list [--lane=audit]
 *   npm run outreach -- summary <lane>
 *
 * Deliberately blunt. The friction of recording an attempt has to be lower than
 * the friction of not recording one, or it will not happen on the day it matters.
 */
import {
  OUTREACH_OUTCOME, logOutreachAttempt, updateOutreachOutcome,
  listOutreachAttempts, outreachSummary
} from '../src/outreach-log.js';
import { databaseEnabled } from '../src/db.js';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

// A write that vanishes is worse than no write: it leaves someone believing the
// attempt was recorded, which is precisely the confusion this module exists to
// end. Reads are fine to run empty; writes refuse.
if (!databaseEnabled && (cmd === 'log' || cmd === 'outcome')) {
  console.error('DATABASE_URL is not set. This would be written to memory and lost when the '
    + 'process exits, leaving you believing the attempt was recorded.\n'
    + 'Set DATABASE_URL and run `npm run migrate` first.');
  process.exit(1);
}
if (!databaseEnabled) {
  console.warn('(DATABASE_URL is not set — reading from an empty in-memory store)\n');
}

try {
  if (cmd === 'log') {
    const r = await logOutreachAttempt({
      lane: flag('lane'), channel: flag('channel'), prospect: flag('prospect'), note: flag('note')
    });
    console.log(r.duplicate
      ? `already contacted ${r.prospect} on ${r.channel} for ${r.lane} (${r.attemptedAt}) — not logged twice`
      : `logged ${r.id}\n  ${r.lane} · ${r.channel} · ${r.prospect}`);
  } else if (cmd === 'outcome') {
    const updated = await updateOutreachOutcome(args[1], args[2]);
    console.log(updated ? `${updated.prospect} → ${updated.outcome}` : `no attempt with id ${args[1]}`);
  } else if (cmd === 'list') {
    const rows = await listOutreachAttempts({ lane: flag('lane') });
    if (!rows.length) console.log('no attempts recorded yet');
    for (const r of rows) {
      console.log(`${r.attemptedAt.slice(0, 10)}  ${r.outcome.padEnd(11)} ${r.lane.padEnd(14)} ${r.channel.padEnd(16)} ${r.prospect}`);
    }
  } else if (cmd === 'summary') {
    const s = await outreachSummary(args[1] || flag('lane'));
    console.log(s.verdict);
    console.log(`  attempts ${s.attempts} · replies ${s.replies} · paid ${s.paid}`);
  } else {
    console.log(`usage:
  npm run outreach -- log --lane=<lane> --channel=<where> --prospect=<handle|url> [--note="..."]
  npm run outreach -- outcome <id> ${Object.values(OUTREACH_OUTCOME).join('|')}
  npm run outreach -- list [--lane=<lane>]
  npm run outreach -- summary <lane>`);
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
process.exit(0);
