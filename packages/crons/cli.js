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

  // When DATABASE_URL is unset, running against in-memory storage allows
  // guardrail checks, smoke runs, and CI scheduled runs to execute and verify health
  // without failing abruptly. In production environments outside CI, explicit opt-in
  // is required so non-persisting runs aren't silently accepted.
  const allowMemory = process.env.TASKMAN_ALLOW_MEMORY_CRON === 'true'
    || process.env.GITHUB_ACTIONS === 'true'
    || process.env.CI === 'true';

  if (!databaseEnabled) {
    if (process.env.TASKMAN_ALLOW_MEMORY_CRON === 'false' || (process.env.NODE_ENV === 'production' && !allowMemory)) {
      console.error(JSON.stringify({
        cronName: name,
        status: 'REFUSED',
        reason: 'DATABASE_URL is not set. A scheduled cron will not run against in-memory storage, '
          + 'because it would do real work, persist nothing, and still report success. '
          + 'Set DATABASE_URL, or set TASKMAN_ALLOW_MEMORY_CRON=true for a throwaway run.'
      }, null, 2));
      return 1;
    }
    console.warn(`[cron:${name}] DATABASE_URL is not set; running in ephemeral memory mode (guardrail check).`);
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
