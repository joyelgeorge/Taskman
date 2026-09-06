/**
 * Where work can be found, and whether the money can actually reach you.
 *
 * A venue is not viable because it lists jobs. It is viable when a specific
 * person, in a specific country, can be paid by it. Those are different
 * questions and only the second one ends in money, so the fields below are the
 * ones that decide it — not job volume, which is the field that looks most
 * encouraging and predicts least.
 *
 * Every claim carries how it was established. `verified` means it was checked
 * against the source named in `evidence`; `assumed` means it is a reasonable
 * belief nobody has confirmed. The distinction exists because this project has
 * already lost a lane to an unverified claim: the Hacker News ranking moat was
 * asserted as checked, was not, and turned out to be false.
 */

export const CONFIDENCE = Object.freeze({ VERIFIED: 'verified', ASSUMED: 'assumed' });

/**
 * What it costs to receive one payment, by rail and country.
 *
 * Recorded because the difference decides whether small tickets work at all. A
 * $20 sale through a US Stripe account nets $19.12. The same $20 into an Indian
 * PayPal account nets closer to $18, because PayPal charges 4.4% plus a fixed
 * fee and then takes a further 3-4% on the currency conversion.
 *
 * fulfilAuditOrder was demonstrated with a US Stripe fee. For an operator in
 * India that understates the cost by roughly a factor of two, which is the
 * difference between a $20 ticket being worth serving and not.
 */
export const PAYOUT_COST = Object.freeze({
  'stripe:US': {
    percent: 2.9, fixedCents: 30, fxPercent: 0,
    confidence: CONFIDENCE.ASSUMED,
    evidence: 'Standard published US card rate.'
  },
  'paypal:IN': {
    percent: 4.4, fixedCents: 30, fxPercent: 3.5,
    confidence: CONFIDENCE.VERIFIED,
    evidence: 'PayPal India inward international: 4.4% + fixed fee, plus a 3-4% conversion '
      + 'markup — roughly Rs 4-6 lost per USD. Checked 2026-09-06.',
    compliance: 'Purpose code required at account setup (P0802 covers software services). '
      + 'A remittance certificate is issued per payment, and export proceeds must be realised '
      + 'within 15 months of invoice date (raised from 9, effective 2025-11-14).'
  }
});

/** What a payment of this size actually leaves you, on a given rail. */
export function netOf(grossCents, railKey) {
  const cost = PAYOUT_COST[railKey];
  if (!cost) return null;
  const fee = Math.round(grossCents * ((cost.percent + cost.fxPercent) / 100)) + cost.fixedCents;
  return { netCents: grossCents - fee, feeCents: fee, takeRatePct: Number(((fee / grossCents) * 100).toFixed(1)) };
}

/**
 * A venue is only an option if every one of these is true. Any single false
 * closes it regardless of how much work it lists.
 */
export function isReachable(venue, { country }) {
  const blockers = [];
  if (!venue.paysTo.includes(country)) {
    blockers.push(`does not pay out to ${country}`);
  }
  if (venue.requiresBusinessEntity) {
    blockers.push('requires a registered business entity, not an individual');
  }
  if (venue.agentPolicy === 'prohibited') {
    blockers.push('platform terms prohibit automated participation');
  }
  return { reachable: blockers.length === 0, blockers };
}

export const VENUES = Object.freeze([
  {
    key: 'direct-paypal',
    title: 'Direct sale, paid by PayPal',
    work: 'Payout reconciliation audits sold from the free tool.',
    rail: 'paypal:IN',
    paysTo: ['IN'],
    requiresBusinessEntity: false,
    agentPolicy: 'unrestricted',
    ticketCents: { min: 500, max: 20_000 },
    confidence: CONFIDENCE.VERIFIED,
    evidence: 'PayPal India receives international payments; inward remittance has no RBI '
      + 'approval threshold. Account exists and the link is live. Checked 2026-09-06.',
    note: 'The only venue here that is open today. No platform sits between the buyer and the '
      + 'payment, which is exactly why it works — nothing to be approved for.'
  },
  {
    key: 'algora',
    title: 'Algora open-source bounties',
    work: 'Fixing bountied GitHub issues.',
    rail: 'stripe:IN',
    paysTo: [],
    requiresBusinessEntity: true,
    agentPolicy: 'prohibited',
    ticketCents: { min: 50, max: 500_000 },
    confidence: CONFIDENCE.VERIFIED,
    evidence: 'Algora pays through Stripe Express, and Stripe is invite-only in India with '
      + 'approvals skewed to registered businesses rather than individuals; Indian accounts '
      + 'receive INR only. Algora terms prohibit robotic access. Checked 2026-09-06.',
    note: 'Two independent blockers, either of which is fatal: the payout rail may not reach an '
      + 'Indian individual at all, and automated participation breaches the terms. The bounty '
      + 'drone still collects from GitHub, which is a public API and not the platform.'
  },
  {
    key: 'fiverr',
    title: 'Fiverr services',
    work: 'Bookkeeping and reconciliation gigs.',
    rail: 'paypal:IN',
    paysTo: ['IN'],
    requiresBusinessEntity: false,
    agentPolicy: 'human-operated-only',
    ticketCents: { min: 500, max: 50_000 },
    confidence: CONFIDENCE.ASSUMED,
    evidence: 'Fiverr operates in India and pays out via PayPal among others. Identity '
      + 'verification is required and the account must be operated by its owner. Not re-checked.',
    note: 'Open to a human with a verified account. The work is machine-doable; the account is not.'
  }
]);

/**
 * The smallest ticket worth accepting on a rail.
 *
 * Fixed fees are what kill small work, not percentages. On PayPal India a $2
 * sale loses 39% to fees and a $20 sale loses 9.4%, entirely because the fixed
 * component does not shrink. "Do lots of small jobs" is sound reasoning about
 * effort and wrong about payments — below a floor the rail eats the ticket, and
 * a machine doing a thousand of them just loses money faster.
 */
export function minimumViableTicket(railKey, { maxTakeRatePct = 10 } = {}) {
  const cost = PAYOUT_COST[railKey];
  if (!cost) return null;
  const variable = (cost.percent + cost.fxPercent) / 100;
  if (variable >= maxTakeRatePct / 100) return null; // the percentage alone exceeds the ceiling
  // fee = gross*variable + fixed, and fee/gross <= ceiling
  return Math.ceil(cost.fixedCents / ((maxTakeRatePct / 100) - variable));
}

/**
 * The honest state of every venue for one operator.
 *
 * Sorted so that what is open comes first, because a list that leads with the
 * largest market rather than the reachable one is how effort goes to the lane
 * that cannot pay.
 */
export function venueOptions({ country = 'IN' } = {}) {
  const assessed = VENUES.map(venue => {
    const reach = isReachable(venue, { country });
    const cost = PAYOUT_COST[venue.rail] || null;
    return {
      ...venue,
      ...reach,
      takeRatePct: cost ? netOf(venue.ticketCents.min, venue.rail)?.takeRatePct ?? null : null,
      railKnown: Boolean(cost)
    };
  });
  const open = assessed.filter(v => v.reachable);
  return {
    country,
    open,
    closed: assessed.filter(v => !v.reachable),
    // Said plainly: the count that matters is how many can pay, not how many exist.
    summary: `${open.length} of ${assessed.length} venue(s) can pay an individual in ${country}.`
  };
}

/**
 * Sources tried for finding people who have this problem, and why they failed.
 *
 * Recorded rather than deleted, so the same searches are not run again in a
 * month and mistaken for a new idea.
 */
export const DISPROVEN_PROSPECT_SOURCES = Object.freeze([
  {
    source: 'GitHub issue search',
    tried: '2026-09-06',
    queries: ['payout + missing/discrepancy', 'reconciliation + mismatch', 'settlement + discrepancy'],
    result: 'Wrong population. GitHub issues are developers building payout features — '
      + '"Payouts: Scheduled payouts", "Payout recording" — not sellers whose money did not '
      + 'arrive. Broad queries additionally match unrelated software senses of "settlement" and '
      + '"mismatch": GNSS odometry, sqlite column counts. 4,263 hits, effectively none of them a '
      + 'prospect.',
    conclusion: 'Not a prospect source. The people with this problem are small operators, and '
      + 'they complain where sellers gather — which is not openly searchable.'
  },
  {
    source: 'Agent-economy marketplaces (dealwork.ai, opentask.ai, and similar)',
    tried: '2026-09-06',
    result: 'Same category as taskforce and moltjobs, which were measured at effectively zero '
      + 'settled volume. Payment is in USDC/SOL/NEAR rather than a rail that reaches an Indian '
      + 'individual, and independent measurement of this market found 73.2% of open agent '
      + 'bounties to be prompt-exfiltration honeypots with roughly 2-5 of 232 listings genuinely '
      + 'doable.',
    conclusion: 'Not re-opened without evidence of real settled volume reaching this country. '
      + 'A new platform name is not new evidence.'
  }
]);
