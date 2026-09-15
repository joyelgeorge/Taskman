/**
 * Scores a candidate territory against the constraints this operator actually
 * lives under, so a discovery run returns a ranked shortlist rather than a wish
 * list. The weights encode hard-won facts: a route that cannot pay an India
 * individual is worth nothing however clever, and a route the existing machine
 * can already fulfil beats one that needs a new capability built first.
 *
 * Every dimension returns 0..1; the composite is a weighted mean, and any
 * fatal dimension (a rail that cannot reach India, an unavoidable KYC the
 * operator will not do) caps the whole score so it cannot rank near the top.
 */

export const DIMENSIONS = {
  // WHO WILL SAY YES WITHOUT A SALES CONVERSATION. The primary filter, adopted
  // 2026-09-14 (docs/READ-FIRST.md). It replaced two earlier methods — rank by
  // revenue ceiling, then rank by how autonomous the loop is — which between
  // them produced the most finished machinery in this repository's history and
  // no revenue, because both ignored the constraint recorded in the registry
  // itself: a machine cannot originate a trusted relationship on its own.
  //
  // `relationship_exists` is the warmest case and was previously not expressible
  // at all, so the scorer would rank a wedge aimed at somebody who already
  // trusts the operator BELOW a cold marketplace lane.
  distribution: {
    weight: 0.35,
    values: {
      relationship_exists: 1,          // the operator already has permission
      buyers_already_searching: 0.9,   // a standing marketplace or search
      findable: 0.5,                   // reachable, but we must go first
      must_create_demand: 0.15         // cold outreach
    },
    // Capped, not fatal. Cold lanes are worth running — the vibe-app scan is one
    // and it produces real leads — they just must not outrank a warm lane on
    // the strength of being fun to build.
    capAt: 0.15
  },
  // How fast a first real dollar is plausible. This week beats this quarter.
  timeToFirstDollar: { weight: 0.2, values: { days: 1, weeks: 0.6, months: 0.3, unclear: 0.1 } },
  // Can the money actually land, anywhere? Not an India question — PayPal alone
  // reaches ~200 countries and bank/wire is universal, so most rails are fine.
  // Card processors (Stripe, Wise, Payoneer) reach 40-190 countries: broadly
  // usable, lightly discounted only for setup/KYC friction. Crypto reaches
  // everywhere but carries tax and volatility drag. Only a genuinely closed or
  // invite-only-with-no-path rail is fatal — and that is now rare.
  payoutReach: { weight: 0.2, values: { paypal_or_bank: 1, card_processor: 0.85, crypto: 0.6, closed: 0 }, fatalAt: 0 },
  // How much can the machine as it stands today actually do — drones, scanner,
  // reconciliation edge-case expertise, honeypot detector, an LLM.
  feasibilityWithAssets: { weight: 0.15, values: { direct: 1, small_build: 0.6, large_build: 0.3, none: 0.1 } },
  // How contested. A lane picked over by full-time pros or swarming agents pays
  // late or never; an underserved niche is where a solo can win.
  saturation: { weight: 0.1, values: { underserved: 1, moderate: 0.6, crowded: 0.3, swarmed: 0.1 } }
};

/** A fatal dimension (no usable payout rail) leaves a lane barely rankable. */
const FATAL_CEILING = 0.2;
/** A capped dimension (cold distribution) can still rank, just never at the top. */
const CAPPED_CEILING = 0.5;

export function scoreTerritory(candidate = {}) {
  const s = candidate.scores || {};
  let composite = 0;
  let cap = 1;
  const detail = {};
  for (const [dim, cfg] of Object.entries(DIMENSIONS)) {
    const label = s[dim];
    const v = cfg.values[label];
    const value = typeof v === 'number' ? v : 0.1; // unknown label -> pessimistic
    detail[dim] = { label: label || 'unknown', value };
    composite += value * cfg.weight;
    if (typeof cfg.fatalAt === 'number' && value <= cfg.fatalAt) cap = Math.min(cap, FATAL_CEILING);
    if (typeof cfg.capAt === 'number' && value <= cfg.capAt) cap = Math.min(cap, CAPPED_CEILING);
  }
  return {
    score: Math.round(Math.min(composite, cap) * 100) / 100,
    capped: cap < 1,
    detail
  };
}

/** Rank novel candidates best-first, dropping fatally-capped ones below a floor. */
export function rankTerritories(candidates = [], { floor = 0.35 } = {}) {
  return candidates
    .map((c) => ({ ...c, ...scoreTerritory(c) }))
    .filter((c) => c.score >= floor)
    .sort((a, b) => b.score - a.score);
}
