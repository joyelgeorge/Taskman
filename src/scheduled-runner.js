import {
  DEFAULT_LEASE_MS,
  finishScheduledJobRun,
  renewScheduledJobLease
} from './durable-scheduler.js';

export async function runClaimedSchedule({
  claim,
  workerName,
  runWorker,
  leaseMs = DEFAULT_LEASE_MS,
  heartbeatIntervalMs = Math.max(1_000, Math.floor(leaseMs / 3)),
  finish = finishScheduledJobRun,
  renew = renewScheduledJobLease,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = () => new Date()
}) {
  if (!claim?.job?.id || !claim.runKey || !claim.leaseToken) {
    throw new Error('A claimed schedule requires job id, run key, and lease token');
  }
  if (typeof runWorker !== 'function') throw new TypeError('runWorker is required');

  let renewalFailure = null;
  let renewalInFlight = Promise.resolve();
  const renewLease = () => {
    if (renewalFailure) return renewalInFlight;
    renewalInFlight = (async () => {
      const outcome = await renew({
        jobId: claim.job.id,
        leaseToken: claim.leaseToken,
        leaseMs,
        now: now()
      });
      if (!outcome?.ok) {
        renewalFailure = new Error(outcome?.reason || 'Scheduled-job lease renewal was fenced');
      }
    })();
    return renewalInFlight;
  };

  const timer = setIntervalFn(() => { void renewLease(); }, heartbeatIntervalMs);
  timer?.unref?.();

  let result = null;
  let workerError = null;
  try {
    try {
      result = await runWorker({ claimedBy: claim.claimedBy });
      await renewalInFlight;
      if (renewalFailure) throw renewalFailure;
    } catch (error) {
      workerError = error;
    }

    const finishResult = await finish({
      jobId: claim.job.id,
      runKey: claim.runKey,
      leaseToken: claim.leaseToken,
      status: workerError ? 'FAILED' : 'COMPLETED',
      result: workerError ? null : result,
      error: workerError ? String(workerError.message || workerError) : null,
      now: now()
    });

    return { ok: finishResult?.ok !== false, finishResult, result, error: workerError };
  } finally {
    clearIntervalFn(timer);
    await renewalInFlight;
  }
}
