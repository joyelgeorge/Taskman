/**
 * Scheduler Concurrency & Single-Flight Policies
 */

export const CONCURRENCY_POLICY = Object.freeze({
  FORBID: 'FORBID', // Default: Skip new firing if previous run is still in flight
  QUEUE_ONE: 'QUEUE_ONE', // Retain at most one pending firing
  ALLOW: 'ALLOW' // Explicit concurrent execution allowed
});

const inFlightTasks = new Set();
let brainInFlight = false;
let brainQueued = false;
const queuedTasks = new Set();

/**
 * Executes task obeying concurrency policy (default FORBID).
 */
export async function executeWithConcurrencyPolicy(task, executeFn, { policy = CONCURRENCY_POLICY.FORBID } = {}) {
  const taskId = task.id;

  if (policy === CONCURRENCY_POLICY.FORBID) {
    if (inFlightTasks.has(taskId)) {
      console.log(`[Taskman Scheduler] Skipping overlapping execution for task ${taskId} (policy: FORBID)`);
      return { skipped: true, reason: 'in_flight_overlap' };
    }
    inFlightTasks.add(taskId);
    try {
      return await executeFn(task);
    } finally {
      inFlightTasks.delete(taskId);
    }
  }

  if (policy === CONCURRENCY_POLICY.QUEUE_ONE) {
    if (inFlightTasks.has(taskId)) {
      queuedTasks.add(taskId);
      return { queued: true };
    }
    inFlightTasks.add(taskId);
    try {
      const res = await executeFn(task);
      if (queuedTasks.has(taskId)) {
        queuedTasks.delete(taskId);
        setImmediate(() => executeWithConcurrencyPolicy(task, executeFn, { policy }).catch(console.error));
      }
      return res;
    } finally {
      inFlightTasks.delete(taskId);
    }
  }

  return executeFn(task);
}

/**
 * Executes brain cycle obeying concurrency policy (default FORBID).
 */
export async function executeBrainWithConcurrencyPolicy(executeFn, { policy = CONCURRENCY_POLICY.FORBID } = {}) {
  if (policy === CONCURRENCY_POLICY.FORBID) {
    if (brainInFlight) {
      console.log('[Taskman Brain] Skipping overlapping brain cycle (policy: FORBID)');
      return { skipped: true, reason: 'brain_cycle_in_flight' };
    }
    brainInFlight = true;
    try {
      return await executeFn();
    } finally {
      brainInFlight = false;
    }
  }

  if (policy === CONCURRENCY_POLICY.QUEUE_ONE) {
    if (brainInFlight) {
      brainQueued = true;
      return { queued: true };
    }
    brainInFlight = true;
    try {
      const res = await executeFn();
      if (brainQueued) {
        brainQueued = false;
        setImmediate(() => executeBrainWithConcurrencyPolicy(executeFn, { policy }).catch(console.error));
      }
      return res;
    } finally {
      brainInFlight = false;
    }
  }

  return executeFn();
}
