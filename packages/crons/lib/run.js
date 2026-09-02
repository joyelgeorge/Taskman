import { registerCron, startCronRun, finishCronRun } from '@taskman/core';
import { runKeyFor } from './slot.js';

/**
 * Wraps a cron handler with everything the watchdog needs.
 *
 * Registration, slot-based idempotency, duration, and an outcome row whether the
 * handler succeeds or throws. A cron that crashes before writing a row is
 * indistinguishable from one that was never scheduled, so the row is opened
 * before the handler runs and closed in a finally.
 */
export async function runCron(definition, handler, { now = new Date(), force = false } = {}) {
  const { cronName, schedule } = definition;
  await registerCron(definition);

  const runKey = force ? `forced@${now.toISOString()}` : runKeyFor(schedule, now);
  const { run, duplicate } = await startCronRun({ cronName, runKey });

  if (duplicate) {
    return { cronName, runKey, status: 'SKIPPED', reason: 'this slot has already run', durationMs: 0 };
  }

  const started = Date.now();
  try {
    const result = (await handler()) ?? {};
    const durationMs = Date.now() - started;
    await finishCronRun(run.id, { status: 'COMPLETED', result, durationMs });
    return { cronName, runKey, status: 'COMPLETED', durationMs, result };
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = String(error?.stack || error?.message || error).slice(0, 2000);
    await finishCronRun(run.id, { status: 'FAILED', error: message, durationMs });
    return { cronName, runKey, status: 'FAILED', durationMs, error: message };
  }
}
