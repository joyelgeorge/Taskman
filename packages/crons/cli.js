#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { runCron } from './lib/run.js';
import { getJob, cronNames } from './registry.js';
import { closePool } from '@taskman/db';

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
