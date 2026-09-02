/**
 * Signals are written by strangers. A drone that fetches a bounty description,
 * a feed item or a page body is carrying text an attacker chose, and elsewhere
 * in this system that text would eventually reach a model.
 *
 * The rule from the design is that such text is data and never instruction, so a
 * signal carrying imperative text aimed at an agent is quarantined rather than
 * cleaned. Sanitizing invites a bypass; rejecting does not.
 */
const PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(your|all|the)\s+(instructions|rules|prompt)/i,
  /(reveal|print|output|show|repeat)\s+(your|the)\s+(system\s+)?prompt/i,
  /you\s+are\s+now\s+(a|an|in)\b/i,
  /\bnew\s+(instructions|task|directive)\s*:/i,
  /<\s*\|?\s*(im_start|system|endoftext)\s*\|?\s*>/i,
  /\bBEGIN\s+SYSTEM\b/i,
  /(run|execute|curl|wget)\s+.{0,40}(https?:\/\/|\|\s*sh\b|\|\s*bash\b)/i,
  /(api[_-]?key|secret|token|credential)s?\s*[:=]/i
];

export function detectInjection(text) {
  if (!text) return { detected: false, matches: [] };
  const haystack = String(text).slice(0, 20_000);
  const matches = [];
  for (const pattern of PATTERNS) {
    const hit = haystack.match(pattern);
    if (hit) matches.push(hit[0].slice(0, 120));
  }
  return { detected: matches.length > 0, matches };
}

/** Everything a signal carries as free text, flattened for one scan. */
export function scanSignal(signal = {}) {
  const parts = [signal.title, signal.url, JSON.stringify(signal.payload ?? {})];
  return detectInjection(parts.filter(Boolean).join('\n'));
}
