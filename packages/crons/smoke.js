#!/usr/bin/env node
import { runCron } from './lib/run.js';
import { jobs } from './registry.js';
import { closePool } from '@taskman/db';
import { listSignals, listAlerts, listImprovements, signalStats } from '@taskman/core';

/**
 * Runs the whole chain once, in order, in a single process.
 *
 * With no DATABASE_URL this exercises the memory path end to end and still makes
 * real outbound requests, so it answers the only question that matters on a fresh
 * checkout: does the system actually collect, process, monitor and report.
 */
// Collection first so later stages have something to read, then the rest in
// registry order — derived rather than hardcoded, so adding a cron cannot
// silently leave it out of the smoke run the way it did twice already.
const FIRST = ['drone-dispatch', 'signal-process', 'data-collect'];
const ORDER = [...FIRST, ...[...jobs.keys()].filter(name => !FIRST.includes(name))];

const pad = (s, n) => String(s).padEnd(n);

console.log(`Taskman smoke run — storage: ${process.env.DATABASE_URL ? 'postgres' : 'memory'}\n`);

for (const name of ORDER) {
  const job = jobs.get(name);
  const outcome = await runCron(job.definition, () => job.handler(), { force: true });
  const summary = outcome.status === 'FAILED'
    ? outcome.error.split('\n')[0]
    : JSON.stringify(outcome.result).slice(0, 110);
  console.log(`${pad(name, 16)} ${pad(outcome.status, 10)} ${pad(`${outcome.durationMs}ms`, 8)} ${summary}`);
}

const [stats, signals, alerts, improvements] = await Promise.all([
  signalStats(), listSignals({ limit: 3 }), listAlerts({ open: true }), listImprovements({ limit: 3 })
]);

console.log(`\nSignals      ${stats.total} total ${JSON.stringify(stats.byStatus)}`);
console.log(`Open alerts  ${alerts.length}`);
console.log(`Proposals    ${improvements.length}`);
if (signals.length) {
  console.log('\nMost recent signals:');
  for (const signal of signals) console.log(`  [${signal.status}] ${signal.droneId} — ${(signal.title || '').slice(0, 70)}`);
}
if (improvements.length) {
  console.log('\nTop proposals:');
  for (const item of improvements) console.log(`  ${item.score} ${item.title}`);
}

await closePool();
