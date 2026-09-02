import { createHash } from 'node:crypto';
import { droneFetch, readPath } from './fetch.js';

const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 32);

/**
 * Reads a JSON endpoint and turns a nested array into signals.
 *
 * config: { itemsPath, idField, titleField, urlField, kind }
 * itemsPath is a dotted path to the array; a blank path means the body is the array.
 */
export const httpJsonDrone = {
  kind: 'http_json',

  async collect(drone, { fetchImpl } = {}) {
    const { text, latencyMs } = await droneFetch(drone.targetUrl, { fetchImpl });

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('response was not valid JSON');
    }

    const config = drone.config || {};
    const items = readPath(body, config.itemsPath);
    if (!Array.isArray(items)) {
      throw new Error(`itemsPath "${config.itemsPath ?? '(root)'}" did not resolve to an array`);
    }

    const signals = items.slice(0, Number(config.limit || 50)).map(item => {
      const id = config.idField ? readPath(item, config.idField) : undefined;
      const title = config.titleField ? readPath(item, config.titleField) : undefined;
      const url = config.urlField ? readPath(item, config.urlField) : undefined;
      return {
        // Prefer the source's own id: it survives edits to the item body.
        fingerprint: hash(id ?? JSON.stringify(item)),
        kind: config.kind || 'record',
        title: title == null ? null : String(title).slice(0, 500),
        url: url == null ? null : String(url).slice(0, 1000),
        payload: item,
        observedAt: new Date().toISOString()
      };
    });

    return { signals, meta: { latencyMs, itemsSeen: items.length } };
  }
};
