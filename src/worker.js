#!/usr/bin/env node
import { runDiscoverWorker } from './workers/discover.js';
import { runValidateWorker } from './workers/validate.js';
import { runExecuteWorker } from './workers/execute.js';
import { claimScheduledJob, finishScheduledJobRun } from './durable-scheduler.js';
import { logRestrictedError, stableErrorCode } from './errors.js';

const command = process.argv[2]?.toLowerCase();

async function main() {
  if (!command || !['discover', 'validate', 'execute', 'all'].includes(command)) {
    console.error('Usage: node src/worker.js <discover|validate|execute|all>');
    process.exit(1);
  }

  console.log(`[Taskman Worker] Running stage: ${command}`);

  if (command === 'discover' || command === 'all') {
    const claim = await claimScheduledJob('discover');
    try {
      const result = await runDiscoverWorker();
      console.log('[Taskman Worker] Discover Result:', JSON.stringify(result, null, 2));
      if (claim) {
        await finishScheduledJobRun({
          jobId: claim.job.id,
          runKey: claim.runKey,
          leaseToken: claim.leaseToken,
          status: 'COMPLETED',
          result
        });
      }
    } catch (err) {
      logRestrictedError(err, { context: 'worker:discover' });
      if (claim) {
        await finishScheduledJobRun({
          jobId: claim.job.id,
          runKey: claim.runKey,
          leaseToken: claim.leaseToken,
          status: 'FAILED',
          error: stableErrorCode(err)
        });
      }
      process.exit(1);
    }
  }

  if (command === 'validate' || command === 'all') {
    const claim = await claimScheduledJob('validate');
    try {
      const result = await runValidateWorker();
      console.log('[Taskman Worker] Validate Result:', JSON.stringify(result, null, 2));
      if (claim) {
        await finishScheduledJobRun({
          jobId: claim.job.id,
          runKey: claim.runKey,
          leaseToken: claim.leaseToken,
          status: 'COMPLETED',
          result
        });
      }
    } catch (err) {
      logRestrictedError(err, { context: 'worker:validate' });
      if (claim) {
        await finishScheduledJobRun({
          jobId: claim.job.id,
          runKey: claim.runKey,
          leaseToken: claim.leaseToken,
          status: 'FAILED',
          error: stableErrorCode(err)
        });
      }
      process.exit(1);
    }
  }

  if (command === 'execute' || command === 'all') {
    const claim = await claimScheduledJob('execute');
    try {
      const result = await runExecuteWorker();
      console.log('[Taskman Worker] Execute Result:', JSON.stringify(result, null, 2));
      if (claim) {
        await finishScheduledJobRun({
          jobId: claim.job.id,
          runKey: claim.runKey,
          leaseToken: claim.leaseToken,
          status: 'COMPLETED',
          result
        });
      }
    } catch (err) {
      logRestrictedError(err, { context: 'worker:execute' });
      if (claim) {
        await finishScheduledJobRun({
          jobId: claim.job.id,
          runKey: claim.runKey,
          leaseToken: claim.leaseToken,
          status: 'FAILED',
          error: stableErrorCode(err)
        });
      }
      process.exit(1);
    }
  }
}

main().catch(err => {
  logRestrictedError(err, { context: 'worker:main' });
  process.exit(1);
});
