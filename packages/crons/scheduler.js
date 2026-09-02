#!/usr/bin/env node
import { runCron } from './lib/run.js';
import { jobs } from './registry.js';
import { slotSeconds } from './lib/slot.js';

/**
 * In-process scheduler for local development and for any host that gives you one
 * long-running process instead of cron triggers.
 *
 * Production uses external schedulers; this exists so the whole system can be run
 * on a laptop with one command. Both paths write the same slot keys, so running
 * this against a shared database will not double-execute work the hosted
 * scheduler already did.
 */
const timers = [];

function schedule(job) {
  const seconds = slotSeconds(job.definition.schedule);
  const tick = async () => {
    try {
      const outcome = await runCron(job.definition, () => job.handler());
      if (outcome.status !== 'SKIPPED') {
        console.log(`[${new Date().toISOString()}] ${outcome.cronName} → ${outcome.status} (${outcome.durationMs}ms)`);
        if (outcome.error) console.error(`  ${outcome.error.split('\n')[0]}`);
      }
    } catch (error) {
      console.error(`[scheduler] ${job.definition.cronName} threw:`, error.message);
    }
  };

  tick();
  const timer = setInterval(tick, seconds * 1000);
  timers.push(timer);
  console.log(`scheduled ${job.definition.cronName.padEnd(16)} every ${String(seconds).padStart(6)}s  (${job.definition.schedule})`);
}

console.log('Taskman scheduler — Ctrl-C to stop\n');
for (const job of jobs.values()) schedule(job);

const shutdown = () => { timers.forEach(clearInterval); console.log('\nstopped'); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
