#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { runCron } from './lib/run.js';
import { getJob, cronNames } from './registry.js';
import { closePool, databaseEnabled } from '@taskman/db';

/**
 * Single entry point for every cron, so the hosted scheduler needs only one
 * command shape: `npm run cron -- <name>`. Exits non-zero on failure so a
 * scheduler that surfaces exit codes (GitHub Actions does) shows the failure
 * without anyone reading logs.
 */
export async function main(argv = process.argv.slice(2)) {
  const name = argv[0];
  const force = argv.includes('--force');

  if (!name || name === '--help') {
    console.log(`Usage: npm run cron -- <name> [--force]\n\nCrons:\n  ${cronNames.join('\n  ')}`);
    return 0;
  }

  // Without DATABASE_URL every store falls back to an in-process Map. A cron
  // would then fly real drones, spend real time, write to memory, exit, and
  // report COMPLETED — and the watchdog would see a healthy system that has
  // persisted nothing. That silent success is the exact failure class this
  // system exists to eliminate, so a scheduled run refuses it outright.
  //
  // GITHUB_ACTIONS/CI must NOT be treated as permission. Actions is where the
  // scheduled crons actually run, so allowing memory there does not make a
  // smoke test pass — it makes every real scheduled run green while it
  // persists nothing. Measured on this repo: drone-dispatch collected 81 live
  // signals, reported COMPLETED, exited 0, and discarded all 81.
  //
  // Local dev, smoke runs and tests opt in explicitly, and only explicitly.
  if (!databaseEnabled && process.env.TASKMAN_ALLOW_MEMORY_CRON !== 'true') {
    console.error(JSON.stringify({
      cronName: name,
      status: 'REFUSED',
      reason: 'DATABASE_URL is not set. A scheduled cron will not run against in-memory storage, '
        + 'because it would do real work, persist nothing, and still report success. '
        + 'Set DATABASE_URL, or set TASKMAN_ALLOW_MEMORY_CRON=true for a local throwaway run.'
    }, null, 2));
    return 1;
  }

  const job = getJob(name);
  const outcome = await runCron(job.definition, () => job.handler(), { force });

  console.log(JSON.stringify(outcome, null, 2));
  return outcome.status === 'FAILED' ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(async code => { await closePool(); process.exit(code); })
    .catch(async error => { console.error(error); await closePool(); process.exit(1); });
}
