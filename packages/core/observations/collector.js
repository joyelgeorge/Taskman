import { USER_AGENT, readPath } from '../drones/fetch.js';
import { isAllowed } from './robots.js';

/**
 * Fetches one observation source and normalizes it into series points.
 *
 * Two kinds only, both against official published feeds: `http_json` and
 * `http_xml`. There is deliberately no HTML-scraping kind — every source in
 * this store is something a publisher intended to be consumed, which is what
 * keeps the licence question answerable and the legal exposure at zero.
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
    const points = source.kind === 'http_xml'
      ? pointsFromXml(response.text, config, observedAt)
      : pointsFromJson(response.text, config, observedAt);
    return { status: 'OK', points, latencyMs: response.latencyMs };
  } catch (error) {
    return { status: 'FAILED', points: [], reason: String(error.message || error).slice(0, 300) };
  }
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
