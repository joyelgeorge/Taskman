import { USER_AGENT } from '../drones/fetch.js';

/**
 * The deterministic version of "open it in a browser and look" — the exact
 * reconnaissance done by hand against Upwork, Fiverr, and California's
 * unclaimed-property registry, expressed as rules instead of eyeballing.
 *
 * A satellite scan answers one question a drone (packages/core/drones) never
 * needs to ask, because a drone only ever runs against a source already known to
 * work: is this venue even reachable by an honest automated client, and what
 * shape is it — a job board, a catalog, a single-record lookup, a bulk dataset?
 *
 * Deliberately not trying to defeat what it finds. USER_AGENT is the same
 * transparent, non-spoofed string every drone uses — the point of this probe is
 * to honestly ask "does an obviously-automated client get blocked here," which
 * is exactly the question that determines whether the venue can be automated at
 * all. Nothing here executes JavaScript, retries past a block, or attempts to
 * look more human; a page that requires real rendering to show its true shape
 * comes back UNDETERMINED, not guessed.
 *
 * Uses its own guarded GET rather than drones/fetch.js's droneFetch(): a block
 * page is usually served as an ordinary non-2xx response, and droneFetch reads
 * the body then discards it before throwing on that path — reasonable for a
 * collector that only wants content on success, wrong here, where the block
 * page's own text is the finding.
 */
const SCAN_TIMEOUT_MS = 15_000;
const MAX_BYTES = 2_000_000;

async function guardedGet(url, { fetchImpl = fetch, timeoutMs = SCAN_TIMEOUT_MS } = {}) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }
  const started = Date.now();
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error(`response exceeded ${MAX_BYTES} bytes`);
  return { text, status: response.status, ok: response.ok, latencyMs: Date.now() - started };
}

const BOT_DEFENSE_SIGNATURES = Object.freeze([
  { vendor: 'cloudflare', pattern: /just a moment/i },
  { vendor: 'cloudflare', pattern: /verify you are human/i },
  { vendor: 'cloudflare', pattern: /checking your browser/i },
  { vendor: 'cloudflare', pattern: /cf-mitigated/i },
  { vendor: 'cloudflare', pattern: /__cf_chl/i },
  { vendor: 'perimeterx', pattern: /needs a human touch/i },
  { vendor: 'perimeterx', pattern: /press\s*(&|and)\s*hold/i },
  { vendor: 'perimeterx', pattern: /perimeterx/i },
  { vendor: 'generic', pattern: /are you a robot/i },
  { vendor: 'generic', pattern: /unusual traffic/i },
  { vendor: 'generic', pattern: /access denied/i },
  { vendor: 'generic', pattern: /request unsuccessful/i },
  { vendor: 'generic', pattern: /\berrcode\b/i },
  { vendor: 'generic', pattern: /\bcaptcha\b/i },
  { vendor: 'generic', pattern: /\brecaptcha\b/i },
  { vendor: 'generic', pattern: /\bhcaptcha\b/i }
]);

/**
 * Keyword families for the four venue shapes this system currently cares about.
 * A shape is asserted only when at least MIN_SIGNAL_HITS distinct phrases from
 * one family are present — one incidental word ("gig") is not evidence, three
 * phrases from the same family is. Below the threshold the scan reports
 * 'unknown' rather than guess, exactly as a human would say "I can't tell yet."
 */
const SHAPE_SIGNALS = Object.freeze({
  job_board: ['post a job', 'apply now', 'proposals', 'browse jobs', 'find work', 'hire freelancers', 'job search', 'submit a proposal'],
  catalog: ['add to cart', 'starting at $', 'seller level', 'buy now', 'order now', 'gig', 'delivery time'],
  single_lookup: ['last name', 'first name', 'search below', 'enter your name', 'property owner', 'claim your property', 'begin your search'],
  bulk_data: ['api reference', 'download csv', 'bulk export', 'developer docs', 'rate limit', 'api key']
});
const MIN_SIGNAL_HITS = 2;
const MIN_MEANINGFUL_BODY_LENGTH = 400;

function stripTags(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectBotDefense(text) {
  for (const { vendor, pattern } of BOT_DEFENSE_SIGNATURES) {
    const match = text.match(pattern);
    if (match) return { defended: true, vendor, signal: match[0].slice(0, 80) };
  }
  return { defended: false, vendor: null, signal: null };
}

function classifyShape(text) {
  const haystack = text.toLowerCase();
  const scored = Object.entries(SHAPE_SIGNALS).map(([shape, phrases]) => ({
    shape,
    hits: phrases.filter(phrase => haystack.includes(phrase)).length
  })).sort((a, b) => b.hits - a.hits);

  const top = scored[0];
  if (!top || top.hits < MIN_SIGNAL_HITS) {
    return { shape: 'unknown', confidence: 0, hits: top?.hits || 0 };
  }
  // Confidence is deliberately coarse — how many of that family's phrases
  // matched, capped at 1. Not a probability; a hint for how much to trust the
  // label without reading the evidence.
  const confidence = Number(Math.min(1, top.hits / SHAPE_SIGNALS[top.shape].length).toFixed(3));
  return { shape: top.shape, confidence, hits: top.hits };
}

/**
 * Runs one honest, single GET against a candidate venue and returns a
 * structured verdict. Never throws for a reachability failure — an
 * unreachable/erroring target is itself the finding, recorded as
 * `reachable: false`, not an exception the caller has to handle specially.
 */
export async function scanTarget({ targetKey, targetUrl, fetchImpl } = {}) {
  if (!targetKey) throw new Error('targetKey is required');
  if (!targetUrl) throw new Error('targetUrl is required');

  const base = { targetKey, targetUrl, scannedAt: new Date().toISOString() };

  let response;
  try {
    response = await guardedGet(targetUrl, { fetchImpl });
  } catch (error) {
    // A genuine network/DNS/timeout failure, not an HTTP error status — those
    // come back as a normal (non-ok) response below and still get inspected.
    return {
      ...base,
      reachable: false,
      httpStatus: null,
      botDefended: false,
      botDefenseVendor: null,
      botDefenseSignal: null,
      shape: 'unknown',
      shapeConfidence: 0,
      verdict: `unreachable: ${String(error.message || error).slice(0, 200)}`,
      evidence: { error: String(error.message || error).slice(0, 500) },
      latencyMs: null
    };
  }

  const text = stripTags(response.text);
  const defense = detectBotDefense(response.text); // scan raw HTML too — some vendor markers live in markup stripTags discards
  const statusSuggestsBlock = [401, 403, 429, 503].includes(response.status);
  const botDefended = defense.defended || (!response.ok && statusSuggestsBlock);
  const classification = botDefended ? { shape: 'unknown', confidence: 0, hits: 0 } : classifyShape(text);

  let verdict;
  if (botDefended) {
    const vendorNote = defense.vendor ? `${defense.vendor}: "${defense.signal}"` : `HTTP ${response.status}`;
    verdict = `reachable but bot-defended (${vendorNote}) — not automatable without a real browser and consent to solve its challenge, which this system will not do`;
  } else if (!response.ok) {
    verdict = `reachable but returned HTTP ${response.status} with no bot-defense signature — an ordinary error, not (as far as this probe can tell) a block`;
  } else if (text.length < MIN_MEANINGFUL_BODY_LENGTH) {
    verdict = `reachable, not bot-defended, but the response body is only ${text.length} chars — likely a JS-rendered shell; shape undetermined without real browser rendering, not guessed from an empty page`;
  } else if (classification.shape === 'unknown') {
    verdict = `reachable, not bot-defended, but no shape family cleared ${MIN_SIGNAL_HITS} matched phrases — needs a human look`;
  } else {
    verdict = `reachable, not bot-defended, shape looks like ${classification.shape} (${classification.hits} matched phrases)`;
  }

  return {
    ...base,
    reachable: true,
    httpStatus: response.status,
    botDefended,
    botDefenseVendor: defense.vendor,
    botDefenseSignal: defense.signal,
    shape: classification.shape,
    shapeConfidence: classification.confidence,
    verdict,
    evidence: {
      httpStatus: response.status,
      ok: response.ok,
      bodyLength: text.length,
      titleGuess: (response.text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim()?.slice(0, 200) || null
    },
    latencyMs: response.latencyMs
  };
}

export { BOT_DEFENSE_SIGNATURES, SHAPE_SIGNALS, MIN_SIGNAL_HITS };
