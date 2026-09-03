import { USER_AGENT } from '../drones/fetch.js';

/**
 * robots.txt, checked and obeyed — enforced here rather than promised in a doc.
 *
 * A disallowed path is a refusal, recorded as such, never retried and never
 * worked around. This is the same posture the satellite scanner takes toward
 * bot defenses (packages/core/scans/prober.js): what the site says is a
 * finding, not an obstacle.
 *
 * Deliberately conservative in both directions: a robots.txt that cannot be
 * fetched is treated as "allowed" (the widely-accepted convention — an absent
 * file means no restrictions), but any explicit Disallow that matches wins.
 */

const cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Minimal but correct-enough parser: the groups that apply to us, in order. */
export function parseRobots(text, userAgent = USER_AGENT) {
  const lines = String(text).split(/\r?\n/).map(l => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const groups = [];
  let current = null;

  for (const line of lines) {
    const [rawField, ...rest] = line.split(':');
    const field = rawField.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (!value && field !== 'disallow') continue;

    if (field === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === 'disallow' || field === 'allow')) {
      current.rules.push({ type: field, path: value });
    }
  }

  const agentLower = userAgent.toLowerCase();
  // A group naming us specifically beats the wildcard group.
  const specific = groups.find(g => g.agents.some(a => a !== '*' && agentLower.includes(a)));
  const wildcard = groups.find(g => g.agents.includes('*'));
  return (specific || wildcard || { rules: [] }).rules;
}

/** Longest matching rule wins; Allow beats Disallow at equal length (per spec). */
export function isAllowedByRules(rules, pathname) {
  let decision = true;
  let matchedLength = -1;

  for (const rule of rules) {
    if (rule.path === '') {
      // "Disallow:" with an empty value explicitly allows everything.
      if (rule.type === 'disallow' && matchedLength < 0) decision = true;
      continue;
    }
    const pattern = rule.path.replace(/\*+$/, '');
    if (!pathname.startsWith(pattern)) continue;
    if (pattern.length > matchedLength || (pattern.length === matchedLength && rule.type === 'allow')) {
      matchedLength = pattern.length;
      decision = rule.type === 'allow';
    }
  }
  return decision;
}

export async function isAllowed(url, { fetchImpl = fetch, now = Date.now() } = {}) {
  const parsed = new URL(url);
  const robotsUrl = `${parsed.origin}/robots.txt`;

  const cached = cache.get(robotsUrl);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return { allowed: isAllowedByRules(cached.rules, parsed.pathname), robotsUrl, cached: true };
  }

  let rules = [];
  try {
    const response = await fetchImpl(robotsUrl, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT, accept: 'text/plain' },
      signal: AbortSignal.timeout(10_000)
    });
    // 4xx means no robots.txt worth honouring; anything else we parse.
    if (response.ok) rules = parseRobots(await response.text());
  } catch {
    // Unreachable robots.txt is conventionally "no restrictions". Not an
    // excuse to hammer the host — the caller's interval still applies.
    rules = [];
  }

  cache.set(robotsUrl, { rules, at: now });
  return { allowed: isAllowedByRules(rules, parsed.pathname), robotsUrl, cached: false };
}

export function resetRobotsCache() { cache.clear(); }
