import { createHash } from 'node:crypto';
import { droneFetch } from './fetch.js';

const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 32);

export function extractText(html, selectorHint = null) {
  let working = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // A hint narrows the watch to one region, so unrelated page furniture
  // (nav, ads, timestamps) does not read as a change every single run.
  if (selectorHint) {
    const region = working.match(new RegExp(`<[^>]*\\b(?:id|class)=["'][^"']*${selectorHint}[^"']*["'][^>]*>([\\s\\S]*?)</[a-z]+>`, 'i'));
    if (region) working = region[1];
  }

  return working.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Watches a page and emits a signal carrying the content hash.
 *
 * There is no "previous value" to store: the fingerprint is the content hash, so
 * an unchanged page collides with the row already in `signals` and yields zero
 * new signals. The unique index does the change detection.
 */
export const pageWatchDrone = {
  kind: 'page_watch',

  async collect(drone, { fetchImpl } = {}) {
    const { text, latencyMs } = await droneFetch(drone.targetUrl, {
      fetchImpl,
      headers: { accept: 'text/html,application/xhtml+xml' }
    });

    const content = extractText(text, drone.config?.selectorHint || null);
    const digest = hash(content);

    return {
      signals: [{
        fingerprint: digest,
        kind: drone.config?.kind || 'page_change',
        title: drone.name,
        url: drone.targetUrl,
        payload: { contentHash: digest, length: content.length, excerpt: content.slice(0, 1000) },
        observedAt: new Date().toISOString()
      }],
      meta: { latencyMs, itemsSeen: 1, contentLength: content.length }
    };
  }
};
