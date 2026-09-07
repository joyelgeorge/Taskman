/**
 * The memory that stops the money machine from rediscovering the same few
 * lanes. Every territory we have actually explored is recorded here with its
 * verdict and the reason, so a discovery run can be told "not these" and has to
 * earn its output by proposing something genuinely new.
 *
 * This is written from what this project learned the hard way, not from a
 * brainstorm. A killed lane names why it died, because "we tried X" without the
 * reason invites trying X again in a new hat.
 */

export const VERDICT = {
  ACTIVE: 'active',       // in use or being worked now
  UNPROVEN: 'unproven',   // plausible, not yet tested
  KILLED: 'killed'        // tried or analysed and rejected, with a reason
};

export const EXPLORED_TERRITORIES = [
  { key: 'github-bounty-hunt', verdict: VERDICT.ACTIVE,
    note: 'Qualified GitHub bounties. Picked clean: 403 listings -> 0 winnable once assigned/contested/hardware-gated filters apply.' },
  { key: 'oss-vuln-sweep', verdict: VERDICT.ACTIVE,
    note: 'Static scan of in-scope Node.js OSS for CWE-22/78/918, PoC-gated. Live drone. No payable bug yet in hardened flagships.' },
  { key: 'audit-tool-contingency', verdict: VERDICT.ACTIVE,
    note: 'Payout-reconciliation audit tool, 20% contingency. Live and priced. Bottleneck is inbound demand, not code.' },
  { key: 'huntr-oss', verdict: VERDICT.ACTIVE,
    note: 'huntr open-source vuln bounties. Profile verified, payout via Stripe Connect Express (reaches most countries).' },
  { key: 'fiverr-ai-debug-gig', verdict: VERDICT.ACTIVE,
    note: 'Fiverr gig: find production bugs in AI-written apps. Operator-run; needs human KYC and delivery.' },
  { key: 'hackerone-bugcrowd-source-scope', verdict: VERDICT.UNPROVEN,
    note: 'Only the sliver of programs with public source in scope fits a static scanner; most targets are black-box and off-limits to scan.' },
  { key: 'defi-arbitrage', verdict: VERDICT.KILLED,
    note: 'Loses money on failed attempts; spread is taken by colocated searchers. Negative expectancy for a non-colocated solo.' },
  { key: 'hn-ranking-dataset', verdict: VERDICT.KILLED,
    note: 'No moat: the publisher archives the exact front-page list since 2014. Nothing to sell that is not already free.' },
  { key: 'agent-economy-marketplaces', verdict: VERDICT.KILLED,
    note: 'Measured 73% prompt-exfiltration honeypots, ~2-5 of 232 listings real, crypto-only rails.' },
  { key: 'algora-bounties', verdict: VERDICT.KILLED,
    note: 'Terms prohibit robotic/automated access. That is the kill, and it holds regardless of country — the rail (Stripe Express) is fine almost everywhere.' },
  { key: 'taskforce-moltjobs', verdict: VERDICT.KILLED,
    note: 'Effectively zero settled volume measured. Shipped DISABLED.' }
];

const KNOWN = new Set(EXPLORED_TERRITORIES.map((t) => t.key));
const KILLED = new Set(EXPLORED_TERRITORIES.filter((t) => t.verdict === VERDICT.KILLED).map((t) => t.key));

/** Normalise a free-text name to a comparable key. */
export function toKey(name = '') {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * A candidate is novel only if it is neither already known nor a rename of a
 * killed lane. `aliases` lets a candidate declare the old lanes it might be
 * mistaken for, so "crypto micro-tasks" cannot slip past as new when
 * agent-economy-marketplaces already died for the same reason.
 */
export function isNovel(candidate) {
  const key = toKey(candidate.key || candidate.title || '');
  if (KNOWN.has(key)) return false;
  for (const alias of candidate.aliases || []) {
    if (KILLED.has(toKey(alias)) || KNOWN.has(toKey(alias))) return false;
  }
  return true;
}
