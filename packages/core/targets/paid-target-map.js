/**
 * The target map answers a question the OSS vuln hunt kept getting wrong: not
 * "where are the bugs" but "where are the bugs that PAY". Built from the GitHub
 * Advisory Database (GHSA) — the authoritative record of disclosed OSS vulns.
 *
 * What the data showed (npm, our three classes CWE-22/78/918), and why this
 * module is shaped the way it is:
 *   - The bug classes are abundant in npm — ~21% of recent reviewed advisories.
 *   - But their disclosure is almost entirely UNPAID: references route through
 *     github.com / nvd.nist.gov / CNAs, essentially never through a huntr bounty
 *     (0 of a 21-advisory page). huntr pays, but its scope is AI/ML Python.
 * So a package having our bug class is a CREDENTIAL signal (a CVE, reputation),
 * not by itself a CASH signal. This module scores both, separately and honestly,
 * and never lets credential-value masquerade as money.
 */

/** Paid-signal detection from an advisory's references. Conservative by design:
 *  only a huntr *bounty* link (or an explicit paid-program reference) counts as
 *  a money signal. A plain GitHub/NVD reference does not. */
export function paidSignal(references = []) {
  const refs = references.map((r) => String(r).toLowerCase());
  if (refs.some((r) => /huntr\.(com|dev)\/bounties\//.test(r))) return { pays: true, via: 'huntr-bounty' };
  if (refs.some((r) => /hackerone\.com\/[^/]+\/?$/.test(r) || /bugcrowd\.com\/[^/]+\/?$/.test(r))) return { pays: true, via: 'program-listed' };
  return { pays: false, via: null };
}

/** Credential value: how useful this finding is as a reputation-building CVE,
 *  independent of payment. Fresh + severe + in a small/young package (where a
 *  scanner can actually still find NEW bugs) scores highest. */
export function credentialScore({ severity = 'medium', ageDays = 999, sameClassCount = 1 } = {}) {
  const sev = { critical: 1, high: 0.8, medium: 0.5, low: 0.25 }[String(severity).toLowerCase()] ?? 0.4;
  const fresh = ageDays <= 30 ? 1 : ageDays <= 120 ? 0.7 : ageDays <= 365 ? 0.4 : 0.2;
  // A package with a run of same-class advisories is a repeat offender: the next
  // bug is likelier, and the maintainer clearly is not hardening. Good hunting.
  const repeat = Math.min(1, 0.5 + 0.25 * (sameClassCount - 1));
  return Math.round((sev * 0.45 + fresh * 0.35 + repeat * 0.2) * 100) / 100;
}

/** Rank packages for the hunt. Payers first (rare), then by credential value.
 *  The shape is deliberate: it surfaces the few real payers without pretending
 *  the unpaid majority are money. */
export function rankTargets(pkgs = []) {
  return pkgs
    .map((p) => ({ ...p, credential: credentialScore(p), ...paidSignal(p.references || []) }))
    .sort((a, b) => (Number(b.pays) - Number(a.pays)) || (b.credential - a.credential));
}
