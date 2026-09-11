/**
 * Turn a vibe-coded-app scan result into the record we are willing to store.
 *
 * A lead names a real business and the weaknesses found in its code, so this
 * module exists to decide what is safe to keep. The operator's ruling: the
 * finding CLASS only. Never a file path, a line number, or an excerpt.
 *
 * The scanner already refuses to retain a secret value. This is the second
 * wall, placed at the persistence boundary, because that is the point where a
 * mistake becomes durable. It works by allow-list — only named fields are
 * copied out — so a future audit rule that adds a field nobody remembered to
 * strip cannot leak it by default. SENSITIVE_KEYS is kept alongside as an
 * explicit, reviewable statement of what must never appear.
 */

export const LEAD_CAMPAIGN_KEY = 'vibe-coded-app-security';

/** Named so the rule is reviewable, and asserted against in the tests. */
export const SENSITIVE_KEYS = Object.freeze([
  'file', 'line', 'excerpt', 'snippet', 'evidence', 'match', 'value', 'secret', 'token', 'key'
]);

const CRITICAL_CLASSES = new Set(['exposed-secret', 'missing-rls']);

/**
 * Returns the lead record, or null when this scan is not a lead — a repo with
 * no findings, or findings in something that is not a genuine business.
 */
export function toLeadRecord(scanResult = {}, { now = () => new Date().toISOString() } = {}) {
  const findings = Array.isArray(scanResult.findings) ? scanResult.findings : [];
  if (!findings.length) return null;
  if (!scanResult.genuine) return null;

  const classes = [...new Set(findings.map(f => f && f.kind).filter(Boolean))];
  const meta = scanResult.meta || {};

  // Built field by field on purpose. Never spread a finding or the scan result
  // into this object - that is how a path or an excerpt gets in by accident.
  return {
    campaignKey: LEAD_CAMPAIGN_KEY,
    repo: scanResult.repo,
    findingClasses: classes,
    findingCount: findings.length,
    criticalCount: findings.filter(f => CRITICAL_CLASSES.has(f && f.kind)).length,
    stars: typeof meta.stargazers_count === 'number' ? meta.stargazers_count : null,
    homepage: meta.homepage || null,
    scannedAt: now()
  };
}
