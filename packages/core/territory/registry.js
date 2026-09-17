import { vibeAppSecurityDescriptor } from '../jobs/vibe-app-security-default.js';

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

/**
 * Registry entries may also carry the revenue-job fields from
 * packages/core/jobs/job-spec.js — `distribution`, `economics`, `rail`, and
 * `stages` once a job is actually runnable. They live here rather than in a
 * parallel list because this is already the single memory of every lane, and a
 * second list would be a fifth concept to keep in step with four others.
 *
 * `distribution` is the primary ranking dimension (docs/READ-FIRST.md): who will
 * say yes without a sales conversation. It is left off entries where there is no
 * customer to acquire, which is more honest than inventing a label.
 */
export const VERDICT = {
  ACTIVE: 'active',       // in use or being worked now
  UNPROVEN: 'unproven',   // plausible, not yet tested
  KILLED: 'killed'        // tried or analysed and rejected, with a reason
};

export const EXPLORED_TERRITORIES = [
  { key: 'github-bounty-hunt', distribution: 'buyers_already_searching', verdict: VERDICT.KILLED,
    note: 'Qualified GitHub bounties. Picked clean: 403 listings -> 0 winnable once assigned/contested/hardware-gated filters apply. '
      + 'Held ACTIVE until 2026-09-11 while its own note recorded a measurement of zero - the verdict and the evidence disagreed, and the '
      + 'evidence is the part that was checked. 403 to 0 is a result, not an absence of data.' },
  { key: 'oss-vuln-sweep', distribution: 'must_create_demand', verdict: VERDICT.ACTIVE,
    note: 'Static scan of in-scope Node.js OSS for CWE-22/78/918, PoC-gated. Live drone. No payable bug yet in hardened flagships.' },
  { key: 'audit-tool-contingency', distribution: 'must_create_demand', verdict: VERDICT.ACTIVE,
    rail: 'payout-audit', economics: { pricing: 'contingency', rate: 0.20, currency: 'USD' },
    note: 'Payout-reconciliation audit tool, 20% contingency. Live and priced. Bottleneck is inbound demand, not code.' },
  { key: 'huntr-oss', distribution: 'buyers_already_searching', verdict: VERDICT.ACTIVE,
    note: 'huntr open-source vuln bounties. Profile verified, payout via Stripe Connect Express (reaches most countries).' },
  { key: 'fiverr-ai-debug-gig', distribution: 'buyers_already_searching', verdict: VERDICT.ACTIVE,
    note: 'Fiverr gig: find production bugs in AI-written apps. Operator-run; needs human KYC and delivery.' },
  { key: 'hackerone-bugcrowd-source-scope', distribution: 'buyers_already_searching', verdict: VERDICT.UNPROVEN,
    note: 'Only the sliver of programs with public source in scope fits a static scanner; most targets are black-box and off-limits to scan.' },
  { key: 'defi-arbitrage', verdict: VERDICT.KILLED,
    note: 'Loses money on failed attempts; spread is taken by colocated searchers. Negative expectancy for a non-colocated solo.' },
  { key: 'hn-ranking-dataset', distribution: 'must_create_demand', verdict: VERDICT.KILLED,
    note: 'No moat: the publisher archives the exact front-page list since 2014. Nothing to sell that is not already free.' },
  { key: 'agent-economy-marketplaces', distribution: 'buyers_already_searching', verdict: VERDICT.KILLED,
    note: 'Measured 73% prompt-exfiltration honeypots, ~2-5 of 232 listings real, crypto-only rails.' },
  { key: 'algora-bounties', distribution: 'buyers_already_searching', verdict: VERDICT.KILLED,
    note: 'Terms prohibit robotic/automated access. That is the kill, and it holds regardless of country — the rail (Stripe Express) is fine almost everywhere.' },
  { key: 'tally-smb-leakage-audit', distribution: 'relationship_exists', verdict: VERDICT.UNPROVEN,
    rail: 'tally-leakage', economics: { pricing: 'contingency', rate: 0.20, currency: 'INR' },
    note: 'Duplicate-invoice and shrinkage detection in a small retailer\'s Tally ledger, priced as a contingency on what they recover. '
      + 'Same model as audit-tool-contingency; the difference is distribution, which is the only thing that has ever blocked this project. '
      + 'The operator states they already have permitted access to one real retailer, so no cold outreach is required. UNPROVEN until that '
      + 'access is confirmed and one payment clears - the access claim is the whole basis of its priority and has not been verified here.' },
  { key: 'licensed-human-verticals', distribution: 'findable', verdict: VERDICT.KILLED,
    note: 'Healthcare claim denials, legal invoice audits, manufacturing yield loss, construction overruns. Detection is tractable; the '
      + 'INTERVENE step needs a licensed or expert human to act, which rebuilds the consultancy overhead this project exists to avoid. '
      + 'Killed on fulfilment, not on market size - the market size is real and is what keeps proposing them.' },
  // The only lane in this list that is a runnable job rather than a note: its
  // stages are real and the runner's gates apply to them.
  { ...vibeAppSecurityDescriptor, verdict: VERDICT.UNPROVEN },
  { key: 'russia-cis-freelance', distribution: 'buyers_already_searching', verdict: VERDICT.KILLED,
    note: 'Killed on the payment rail, not the market. Q1 2026 carries a granular infrastructure blockade - bank-specific SWIFT cutoffs, '
      + 'correspondent-account bans, card-network exits - breaking payment mechanically whether or not any party is sanctioned; PayPal '
      + 'effectively unavailable. Same shape as algora-bounties: volume is irrelevant when the money cannot arrive. Researched 2026-09-17.' },
  { key: 'china-freelance', distribution: 'buyers_already_searching', verdict: VERDICT.UNPROVEN,
    note: 'No usable data on India->China individual payment rails. Known shape (local entity, Alipay/WeChat) makes answering gate 1 expensive '
      + 'in itself. Unproven rather than guessed - do not build toward it before the rail question is answered. Researched 2026-09-17.' },
  { key: 'latam-non-english-content', distribution: 'must_create_demand', verdict: VERDICT.UNPROVEN,
    note: 'Workana: 2M freelancers, 600k companies, Spanish/Portuguese, commission falling 20/10/5% with relationship depth. Competing there as '
      + 'another freelancer is the $10-40 race already lost. The untested part is CONTENT: all 13 counted competitors publish in English, so a '
      + 'translated teardown competes against nothing. Near-zero cost, the artifact exists. Researched 2026-09-17.' },
  { key: 'ai-agent-marketplaces', distribution: 'buyers_already_searching', verdict: VERDICT.UNPROVEN,
    note: 'Agent market $7.6B 2025 to a projected $47B 2030; marketplace splits 70-85% to creator; productised agents $20-100/mo per user. Named '
      + 'top-2026 niches include "financial reconciliation bots for small businesses", which is what packages/core/tally/duplicate-invoice.js is. '
      + 'The marketplace supplies distribution - the half every lane here has died on. Gate 1 open: which marketplace pays an Indian individual. '
      + 'Researched 2026-09-17.' },
  { key: 'taskforce-moltjobs', distribution: 'buyers_already_searching', verdict: VERDICT.KILLED,
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
