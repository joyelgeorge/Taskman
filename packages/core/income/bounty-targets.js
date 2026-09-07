/**
 * Bounty programs whose source code is public, so the scanner has somewhere legal
 * to point.
 *
 * This is the intersection the whole pipeline was missing. A normal bug bounty
 * target is a black box: you may not scan it without that program's permission,
 * and src/codebase-audit.js needs source to read. An open-source program is
 * different — the code is published for anyone to read, reading it is not an
 * intrusion, and a finding still pays.
 *
 * What this does NOT change: a report is submitted by a person, and only security
 * impact is worth submitting.
 *
 * That second point is the one to be honest about. The scanner finds reliability
 * defects — a date that shifts a day, a write that silently discards a row. Most
 * of those are bugs and not vulnerabilities, and filing them as security reports
 * wastes a triager's time and damages a new reputation. The subset that does
 * qualify is where the defect crosses into security: a fallback that reports
 * success on a failed authorization write, a constraint that lets invalid state
 * through, arithmetic in a payment path that can be driven to the wrong answer.
 * Judge that before submitting, every time.
 */

export const OSS_BOUNTY_TARGETS = Object.freeze([
  {
    key: 'square-open-source',
    program: 'https://hackerone.com/square-open-source',
    org: 'square',
    domain: 'payments',
    why: 'A payments company publishing its libraries under a bounty program. The closest '
      + 'available match to payout and settlement expertise: the code handles money, the source '
      + 'is public, and findings pay.',
    confidence: 'verified',
    evidence: 'Program page live on HackerOne. Checked 2026-09-07.'
  },
  {
    key: 'vercel-open-source',
    program: 'https://hackerone.com/vercel-open-source',
    org: 'vercel',
    domain: 'web infrastructure',
    why: 'All Vercel open-source projects in scope — frameworks and libraries with very wide '
      + 'downstream use, so impact arguments are easier to make.',
    confidence: 'verified',
    evidence: 'Program opened to the public on HackerOne. Checked 2026-09-07.'
  },
  {
    key: 'internet-bug-bounty',
    program: 'https://hackerone.com/ibb',
    org: 'various',
    domain: 'core open-source infrastructure',
    why: 'Pooled funding for widely-depended-on open-source projects. Broad scope, high bar.',
    confidence: 'assumed',
    evidence: 'Long-running programme; scope and funding not re-checked against current terms.'
  }
]);

/**
 * Whether a scanner finding is worth a security report, or is merely a bug.
 *
 * Deliberately conservative. A new researcher's first few reports set how their
 * later ones are read, and a queue of valid-but-not-security findings is a worse
 * opening than silence.
 */
export function isReportable(finding) {
  const securityRelevant = {
    // A failure reported as success is a security problem when the thing that
    // failed was a write that something else trusts.
    'silent-fallback': 'only if the swallowed failure is a write another decision depends on — '
      + 'an authorization record, an audit row, a balance. Otherwise it is a reliability bug.',
    // Invalid state that the schema was supposed to prevent.
    'missing-table': 'only if the failing write is security-relevant. A table that does not exist '
      + 'usually means the feature never worked, which is a bug report, not a vulnerability.',
    'storage-divergence': 'not on its own. It explains why a suite is green and production is not; '
      + 'it is not itself a vulnerability.',
    'date-shift': 'rarely. It qualifies where a date decides access or expiry — a token valid a '
      + 'day longer than intended, a retention window that deletes early.'
  };
  return {
    kind: finding.kind,
    reportable: false,
    guidance: securityRelevant[finding.kind]
      ?? 'unknown class — judge it on impact, not on novelty',
    // Never true by default. A human decides, having read the code.
    note: 'This never returns reportable: true. Security impact is an argument about what an '
      + 'attacker gains, and that cannot be derived from the shape of the code alone.'
  };
}
