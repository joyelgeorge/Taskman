import { httpJsonDrone } from './http-json.js';
import { rssDrone } from './rss.js';
import { pageWatchDrone } from './page-watch.js';

const COLLECTORS = new Map([
  [httpJsonDrone.kind, httpJsonDrone],
  [rssDrone.kind, rssDrone],
  [pageWatchDrone.kind, pageWatchDrone]
]);

export const DRONE_KINDS = [...COLLECTORS.keys()];

export function getCollector(kind) {
  const collector = COLLECTORS.get(kind);
  if (!collector) throw new Error(`unknown drone kind: ${kind}`);
  return collector;
}

export { httpJsonDrone, rssDrone, pageWatchDrone };
export { droneFetch, readPath } from './fetch.js';
export { detectInjection, scanSignal } from './injection.js';
export { extractText } from './page-watch.js';
