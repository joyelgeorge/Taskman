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
  // How fast a first real dollar is plausible. This week beats this quarter.
  timeToFirstDollar: { weight: 0.25, values: { days: 1, weeks: 0.6, months: 0.3, unclear: 0.1 } },
  // Can the money actually reach an India individual? PayPal/bank yes; a
  // Stripe-Express-only or invite-only rail is fatal; crypto is discounted for
  // the 30% VDA + 1% TDS drag.
  railFitIndia: { weight: 0.25, values: { paypal_or_bank: 1, crypto: 0.5, stripe_express: 0.4, closed: 0 }, fatalAt: 0 },
  // How much can the machine as it stands today actually do — drones, scanner,
  // reconciliation edge-case expertise, honeypot detector, an LLM.
  feasibilityWithAssets: { weight: 0.2, values: { direct: 1, small_build: 0.6, large_build: 0.3, none: 0.1 } },
  // How contested. A lane picked over by full-time pros or swarming agents pays
  // late or never; an underserved niche is where a solo can win.
  saturation: { weight: 0.15, values: { underserved: 1, moderate: 0.6, crowded: 0.3, swarmed: 0.1 } },
  // Is there a place buyers already gather, or would this need cold outreach we
  // do not do? A standing marketplace or search beats manufacturing demand.
  distribution: { weight: 0.15, values: { buyers_already_searching: 1, findable: 0.6, must_create_demand: 0.2 } }
};

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
    if (typeof cfg.fatalAt === 'number' && value <= cfg.fatalAt) cap = Math.min(cap, 0.2);
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
