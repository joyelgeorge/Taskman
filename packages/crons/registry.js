import * as droneDispatch from './jobs/drone-dispatch.js';
import * as signalProcess from './jobs/signal-process.js';
import * as healthCheck from './jobs/health-check.js';
import * as cronMonitor from './jobs/cron-monitor.js';
import * as revenueCheck from './jobs/revenue-check.js';
import * as improve from './jobs/improve.js';
import * as satelliteScan from './jobs/satellite-scan.js';
import * as dataCollect from './jobs/data-collect.js';
import * as streamDiscovery from './jobs/stream-discovery.js';

const JOBS = [droneDispatch, signalProcess, healthCheck, cronMonitor, revenueCheck, improve, satelliteScan, dataCollect, streamDiscovery];

export const jobs = new Map(JOBS.map(job => [job.definition.cronName, job]));

export function getJob(name) {
  const job = jobs.get(name);
  if (!job) throw new Error(`unknown cron: ${name}. Known: ${[...jobs.keys()].join(', ')}`);
  return job;
}

export const cronNames = [...jobs.keys()];
