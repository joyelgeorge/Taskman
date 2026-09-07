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
  'stripe_express:IN': {
    // Being paid out by a platform, not being a merchant. Different product from
    // standalone Stripe, different availability — the distinction that made an
    // earlier assessment wrong. Indian accounts settle in INR.
    percent: 0, fixedCents: 0, fxPercent: 2,
    confidence: CONFIDENCE.ASSUMED,
    evidence: 'Platform absorbs processing; the cost to the payee is the INR conversion. '
      + 'Modelled at 2% and not measured against a real payout.'
  },
  'crypto:IN': {
    // No processor percentage, but the tax is not optional and lands before the
    // money is spendable: India taxes virtual digital asset gains at a flat 30%
    // with 1% TDS at source, and losses cannot be set off. Recorded on the rail
    // because it is a cost of using this rail, not a footnote.
    percent: 1, fixedCents: 0, fxPercent: 30,
    confidence: CONFIDENCE.ASSUMED,
    evidence: 'India VDA regime: 30% flat tax on gains plus 1% TDS, no loss set-off. Modelled '
      + 'as rail cost because it applies before the proceeds are usable. Not re-checked against '
      + 'the current finance act.'
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
  // Rejected on merits is not the same as unreachable, and collapsing them loses
  // the more useful fact. DeFi arbitrage pays to India, needs no company and
  // welcomes agents — every reachability test passes — and is still a bad lane,
  // because the spread closes before a public RPC answers and a failed attempt
  // costs gas. A model that only asks "can the money arrive" would rank it open.
  if (venue.rejected) {
    blockers.push(`rejected: ${venue.rejected}`);
  }
  if (!venue.paysTo.includes(country)) {
    blockers.push(`does not pay out to ${country}`);
  }
  if (venue.requiresBusinessEntity) {
    blockers.push('requires a registered business entity, not an individual');
  }
  if (venue.agentPolicy === 'prohibited') {
    blockers.push('platform terms prohibit automated participation');
  }
  // Not a blocker — the lane is open, the machine simply cannot finish it alone.
  // Recorded so nobody later reads "open" as "automatable".
  if (venue.agentPolicy === 'discovery-only') {
    venue.humanStep = 'the machine may find and assess; a person reviews and submits';
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
    rejected: 'platform terms prohibit robotic access, so this system may not participate — a '
      + 'human with the same account could',
    title: 'Algora open-source bounties',
    work: 'Fixing bountied GitHub issues.',
    rail: 'stripe_express:IN',
    paysTo: ['IN'],
    requiresBusinessEntity: false,
    agentPolicy: 'prohibited',
    ticketCents: { min: 50, max: 500_000 },
    confidence: CONFIDENCE.VERIFIED,
    evidence: 'Corrected 2026-09-07. The earlier reading conflated two different Stripe products. '
      + 'Standalone Stripe — being your own merchant — is invite-only in India and skewed to '
      + 'registered businesses. Stripe CONNECT EXPRESS, being paid out by someone else\'s '
      + 'platform, is a separate product and does reach India: Polar documents that "any '
      + 'individual or company operating in our supported countries can receive payouts even if '
      + 'Stripe standalone is invite-only there", and states publicly that it has Indian users '
      + 'paid without issue. Algora pays over that same rail. What remains true is that Algora\'s '
      + 'terms prohibit robotic access.',
    note: 'Reopened as reachable, and still closed to this system. The money can arrive — the '
      + 'blocker is the automation ban, not the border. A person may use it; this machine may '
      + 'not. That distinction was lost when the rail was wrongly assessed, and the wrong reason '
      + 'made the right conclusion look better established than it was.'
  },
  {
    /**
     * Renting out hardware that is already owned and already idle.
     *
     * Structurally unlike everything else here: no customer to find, no bounty to
     * win, no maintainer to convince, no account to be approved for beyond a
     * wallet. The work is the machine sitting there. That makes it the only lane
     * the operator can start alone and finish alone.
     *
     * io.net does support Apple Silicon — it announced M-series support and
     * documents M1 through M3 — so the module's metalSupported flag is not an
     * invention.
     *
     * What is NOT verified is the money. The $15-45/month figure in
     * inference-profiler.js has no source attached, these networks are heavily
     * oversupplied with GPUs, and io.net's own annualised revenue was tracked at
     * roughly $12.5M in mid-2026, below the $20M+ implied by earlier
     * self-reported figures. Supply-side earnings on an oversupplied network are
     * the first thing to fall. Treat the estimate as unmeasured until a real
     * payout is observed.
     *
     * Against it: electricity. Sustained load on an M-series desktop is roughly
     * 40-60W, so about 36 kWh a month, which at Indian domestic rates is close to
     * $3.50. The lane is only worth running if actual payouts clear that with
     * enough margin to notice, and the honest way to find out is to run it for a
     * month and read the ledger.
     */
    key: 'decentralised-compute',
    title: 'Renting idle hardware to a decentralised inference network',
    work: 'Running inference jobs on hardware that is already owned.',
    rail: 'crypto:IN',
    paysTo: ['IN'],
    requiresBusinessEntity: false,
    agentPolicy: 'welcomed',
    ticketCents: { min: 1500, max: 4500 },
    confidence: CONFIDENCE.ASSUMED,
    evidence: 'io.net announced Apple Silicon support and documents M1-M3 as workers. The '
      + '$15-45/month rate carries no source and is not measured. io.net annualised revenue '
      + 'tracked near $12.5M mid-2026, down from $20M+ self-reported. Checked 2026-09-06.',
    note: 'The one lane with no counterparty to persuade. Also the one whose revenue figure is '
      + 'entirely unverified, and paid in tokens that carry India\'s 30% VDA tax and 1% TDS '
      + 'before any of it becomes spendable.'
  },
  {
    /**
     * Rejected, and recorded so it is not rebuilt.
     *
     * The scanner is competent code and the market is real — but capturing L2
     * arbitrage means competing with professional searchers running colocated
     * infrastructure and private orderflow, on spreads that close in
     * milliseconds. A $2 minimum profit threshold against $0.05 gas describes
     * exactly the micro-arbitrage that is taken before a public RPC has even
     * returned.
     *
     * It is also the first lane in this project where the operator can lose
     * money rather than merely fail to make it: it needs capital at risk, or
     * flashloans, which need a deployed contract and gas paid on every failed
     * attempt.
     */
    key: 'defi-arbitrage',
    rejected: 'the spread is taken by colocated searchers before a public RPC answers, and this '
      + 'is the only lane here that loses money on a failed attempt rather than earning none',
    title: 'L2 DEX arbitrage and liquidations',
    work: 'Executing price differences across Base and Arbitrum DEXes.',
    rail: 'crypto:IN',
    paysTo: ['IN'],
    requiresBusinessEntity: false,
    agentPolicy: 'welcomed',
    ticketCents: { min: 200, max: 100_000 },
    confidence: CONFIDENCE.VERIFIED,
    evidence: 'MEV and liquidation revenue is real and large, and is captured by searchers with '
      + 'colocated infrastructure, private orderflow and capital. A solo operator on a public RPC '
      + 'arrives after the spread has closed. Assessed 2026-09-06.',
    note: 'Not opened. The only lane here that can lose money rather than just earn none — it '
      + 'requires capital at risk and pays gas on every failed attempt. Everything else in this '
      + 'system fails to nothing; this one fails to negative.'
  },
  {
    /**
     * The first venue on this list where a large ticket and a rail that reaches
     * India coexist. Profile verified live at hackerone.com/joyelgeorge — checked
     * against a known-bad username returning 404, so the 200 means something.
     *
     * The automation policy needs stating precisely, because getting it wrong
     * here is not a terms violation, it is unauthorised access to someone else's
     * production systems.
     *
     * Discovering PROGRAMS is fine: the directory is public and reading it is
     * reading a website. Running automated scans AGAINST A TARGET is a different
     * act entirely, and is permitted only where that program's own policy says
     * so — many forbid it outright, and doing it anyway is illegal regardless of
     * what this registry says. Submission is always human: a report is a claim
     * made in someone's name.
     *
     * Where this system helps is between those two: reading a program's scope
     * and saying whether the operator's actual expertise applies to it.
     */
    key: 'hackerone',
    title: 'HackerOne security bounties',
    work: 'Business-logic and reliability flaws in payout and settlement flows.',
    rail: 'paypal:IN',
    paysTo: ['IN'],
    requiresBusinessEntity: false,
    agentPolicy: 'discovery-only',
    ticketCents: { min: 10_000, max: 1_000_000 },
    confidence: CONFIDENCE.VERIFIED,
    evidence: 'HackerOne pays researchers by bank transfer and PayPal with no geographic '
      + 'restriction on participation or payment. Profile live at hackerone.com/joyelgeorge, '
      + 'verified 2026-09-07. Known caveat: HackerOne cannot currently pay out to HDFC Bank '
      + 'India, so use another bank or PayPal.',
    note: 'Fintech scopes are the match. Business-logic flaws in payout and settlement flows are '
      + 'underserved next to XSS hunters, and they are exactly what this project spent weeks '
      + 'finding in its own ledger. Scanning a target is only permitted where that program says '
      + 'so; submission is human, always.'
  },
  {
    /**
     * Kept alongside HackerOne rather than instead of it. Same work, different
     * programs, and Bugcrowd settles PayPal the same day where HackerOne does
     * not — which matters when the point is a first non-zero number.
     */
    key: 'bugcrowd',
    title: 'Bugcrowd security bounties',
    work: 'Same as HackerOne; different program inventory.',
    rail: 'paypal:IN',
    paysTo: ['IN'],
    requiresBusinessEntity: false,
    agentPolicy: 'discovery-only',
    ticketCents: { min: 10_000, max: 500_000 },
    // The payout rails are verified. The account is not, and cannot be from here.
    confidence: CONFIDENCE.ASSUMED,
    evidence: 'Rails verified: Bugcrowd supports bank transfer, PayPal and Payoneer, with PayPal '
      + 'crediting the same day and bank transfers in one to two business days.\n'
      + 'Account reported at bugcrowd.com/h/joyelgeorgecb1e11 on 2026-09-07 and NOT '
      + 'independently confirmed. Bugcrowd renders profiles client-side, so a real handle and an '
      + 'invented one return byte-identical 5,996-byte responses, the username appears nowhere '
      + 'in the body, and the .json path does not discriminate either. The same control that '
      + 'proved the HackerOne profile — a known-bad handle returning 404 — returns 200 here, so '
      + 'the status code carries no information.\n'
      + 'Treated as the operator\'s report, which is good enough to act on and not good enough '
      + 'to call verified.',
    note: 'Registered alongside HackerOne rather than instead of it: the programs differ and '
      + 'each costs one signup. Confirmation that the account exists will come from the first '
      + 'submission or the first payout, not from the outside — which is the ordinary case for '
      + 'anything behind a login, and the reason confidence here is assumed rather than verified.'
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
  const rejected = assessed.filter(v => v.rejected);
  const unreachable = assessed.filter(v => !v.reachable && !v.rejected);
  return {
    country,
    open,
    rejected,
    unreachable,
    // Kept for callers that only care whether a lane is available at all.
    closed: assessed.filter(v => !v.reachable),
    // The count that matters is how many can pay, not how many exist — and the
    // two reasons a lane is unavailable are worth telling apart.
    summary: `${open.length} of ${assessed.length} venue(s) are open to an individual in ${country}`
      + `${unreachable.length ? `; ${unreachable.length} cannot pay` : ''}`
      + `${rejected.length ? `; ${rejected.length} rejected on merits` : ''}.`
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
