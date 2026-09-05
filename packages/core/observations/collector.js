import { USER_AGENT, readPath } from '../drones/fetch.js';
import { isAllowed } from './robots.js';

/**
 * Fetches one observation source and normalizes it into series points.
 *
 * Three kinds, all against official published feeds: `http_json`, `http_xml`
 * and `http_json_ranked`. There is deliberately no HTML-scraping kind — every
 * source in this store is something a publisher intended to be consumed, which
 * is what keeps the licence question answerable and the legal exposure at zero.
 *
 * `http_json_ranked` exists for the only data this system can turn into an
 * asset on its own: ordering. A published statistical series is worthless to
 * keep, because the publisher archives it too — our ECB source can be backfilled
 * in one request from eurofxref-hist.xml. A *ranking* is not archived by anyone:
 * what sat at position 3 at 14:00 today is unrecoverable tomorrow, at any price.
 * So this kind reads a list endpoint, then the items it points at, and records
 * one bounded series per slot rather than per item — 30 slots stay 30 series
 * forever, while per-item keys would grow without limit and roll up to nothing.
 *
 * robots.txt is checked before every fetch and a disallowed path returns a
 * refusal rather than an error to retry. Same posture as the satellite
 * scanner: what the site says is a finding, not an obstacle.
 */

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 2_000_000;

/** Pulls `<Cube currency="USD" rate="1.08"/>`-shaped attributes out of XML. */
export function extractXmlAttributes(xml, tagName, attributes) {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)/?>`, 'gi');
  const rows = [];
  for (const match of String(xml).matchAll(pattern)) {
    const attrs = {};
    for (const attr of attributes) {
      const found = match[1].match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']*)["']`, 'i'));
      if (found) attrs[attr] = found[1];
    }
    if (Object.keys(attrs).length) rows.push(attrs);
  }
  return rows;
}

async function guardedGet(url, { fetchImpl = fetch, accept }) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }
  const started = Date.now();
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT, accept },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error(`response exceeded ${MAX_BYTES} bytes`);
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} from ${parsed.host}`);
    error.status = response.status;
    throw error;
  }
  return { text, status: response.status, latencyMs: Date.now() - started };
}

/**
 * @returns {{ status: 'OK'|'REFUSED'|'FAILED', points: Array, reason?: string }}
 *   Never throws — a refusal or failure is itself the finding, recorded by the
 *   caller against the source rather than raised for someone to catch.
 */
export async function collectSource(source, { fetchImpl, now = new Date() } = {}) {
  const config = source.config || {};

  const robots = await isAllowed(source.url, { fetchImpl });
  if (!robots.allowed) {
    return {
      status: 'REFUSED',
      points: [],
      reason: `robots.txt at ${robots.robotsUrl} disallows this path — not retried, not worked around`
    };
  }

  let response;
  try {
    response = await guardedGet(source.url, {
      fetchImpl,
      accept: source.kind === 'http_xml' ? 'application/xml,text/xml' : 'application/json'
    });
  } catch (error) {
    return { status: 'FAILED', points: [], reason: String(error.message || error).slice(0, 300) };
  }

  // observedAt comes from the feed when it publishes one, so a series is dated
  // by when the value was true rather than when we happened to fetch it.
  const observedAt = (config.observedAtPath
    ? tryParseDate(readPathSafely(response.text, source.kind, config.observedAtPath))
    : null) || dayStart(now);

  try {
    if (source.kind === 'http_json_ranked') {
      const points = await pointsFromRankedJson(response.text, config, observedAt, { fetchImpl, source, now });
      return { status: 'OK', points, latencyMs: response.latencyMs };
    }
    const points = source.kind === 'http_xml'
      ? pointsFromXml(response.text, config, observedAt)
      : pointsFromJson(response.text, config, observedAt);
    return { status: 'OK', points, latencyMs: response.latencyMs };
  } catch (error) {
    return { status: 'FAILED', points: [], reason: String(error.message || error).slice(0, 300) };
  }
}

/** Hard ceiling on item fetches per run, so a source cannot become a crawler. */
const MAX_RANKED_SLOTS = 30;

/**
 * Reads a ranking, then the items it references, as one bounded series per slot.
 *
 * Slot-keyed rather than item-keyed on purpose: `hn.slot.01.score` answers "what
 * does it take to hold the top spot" for as long as the series runs, and stays a
 * single row per day. Item-keyed series would be unbounded, would each hold one
 * day of data, and would roll up into nothing worth selling.
 *
 * Every item fetch is same-origin with the list URL — checked, not assumed — so
 * the one robots.txt decision already made for the source governs all of them.
 */
async function pointsFromRankedJson(text, config, observedAt, { fetchImpl, source, now }) {
  const list = JSON.parse(text);
  if (!Array.isArray(list)) throw new Error('a ranked source must return a JSON array of item ids');

  const slots = Math.min(Number(config.slots) || 10, MAX_RANKED_SLOTS);
  const template = config.itemUrlTemplate;
  if (!template || !template.includes('{id}')) {
    throw new Error('itemUrlTemplate with an {id} placeholder is required for a ranked source');
  }
  const listOrigin = new URL(source.url).origin;
  const points = [];

  for (let index = 0; index < Math.min(slots, list.length); index += 1) {
    const itemUrl = template.replace('{id}', encodeURIComponent(String(list[index])));
    if (new URL(itemUrl).origin !== listOrigin) {
      throw new Error(`itemUrlTemplate points off-origin (${new URL(itemUrl).origin}); refusing to follow`);
    }
    let item;
    try {
      const itemResponse = await guardedGet(itemUrl, { fetchImpl, accept: 'application/json' });
      item = JSON.parse(itemResponse.text);
    } catch {
      continue; // one unreadable item is a gap in the series, never a failed run
    }
    if (!item || typeof item !== 'object') continue;

    const slot = String(index + 1).padStart(2, '0');
    for (const [suffix, field] of Object.entries(config.slotFields || {})) {
      const value = Number(item[field]);
      if (!Number.isFinite(value)) continue;
      points.push(point(
        { ...config, seriesPrefix: `${config.seriesPrefix}.slot.${slot}` },
        suffix, value, observedAt, { id: list[index], [field]: item[field] }
      ));
    }
    // Age at the moment it held this rank — recoverable from nothing later.
    if (config.ageSeriesKey && Number.isFinite(Number(item.time))) {
      points.push(point(
        { ...config, seriesPrefix: `${config.seriesPrefix}.slot.${slot}` },
        config.ageSeriesKey,
        Math.max(0, Math.round((now.getTime() / 1000 - Number(item.time)) / 60)),
        observedAt, { id: list[index] }
      ));
    }
  }
  return points;
}

function dayStart(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function tryParseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readPathSafely(text, kind, path) {
  if (kind !== 'http_json') {
    const found = String(text).match(new RegExp(`\\b${path}\\s*=\\s*["']([^"']*)["']`, 'i'));
    return found ? found[1] : null;
  }
  try { return readPath(JSON.parse(text), path); } catch { return null; }
}

function pointsFromJson(text, config, observedAt) {
  const body = JSON.parse(text);
  const container = readPath(body, config.valuesPath);
  if (!container || typeof container !== 'object') {
    throw new Error(`valuesPath "${config.valuesPath ?? '(root)'}" did not resolve to an object`);
  }
  const wanted = Array.isArray(config.keys) && config.keys.length ? config.keys : Object.keys(container);
  return wanted
    .filter(key => container[key] != null)
    .map(key => point(config, key, Number(container[key]), observedAt, { [key]: container[key] }));
}

function pointsFromXml(text, config, observedAt) {
  const { tag, keyAttribute, valueAttribute, keys } = config;
  if (!tag || !keyAttribute || !valueAttribute) {
    throw new Error('http_xml config requires tag, keyAttribute and valueAttribute');
  }
  const rows = extractXmlAttributes(text, tag, [keyAttribute, valueAttribute]);
  const wanted = Array.isArray(keys) && keys.length ? new Set(keys) : null;
  return rows
    .filter(row => row[keyAttribute] && row[valueAttribute] && (!wanted || wanted.has(row[keyAttribute])))
    .map(row => point(config, row[keyAttribute], Number(row[valueAttribute]), observedAt, row));
}

function point(config, key, value, observedAt, payload) {
  return {
    seriesKey: `${config.seriesPrefix || 'series'}.${String(key).toLowerCase()}`,
    valueNum: Number.isFinite(value) ? value : null,
    valueText: Number.isFinite(value) ? null : String(value),
    payload,
    observedAt
  };
}
