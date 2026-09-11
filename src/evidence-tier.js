/**
 * Evidence tiers: how much a candidate has earned the right to assert.
 *
 * The anti-fabrication rule this implements exists because invented
 * counterparties ("Apex Digital Creative", 120 orders, escrow: true) drove
 * real execution pipelines. But a rule that demands an external reference
 * before a candidate may EXIST would confine the engine to what is already
 * listed on a board — which the territory registry records as picked clean
 * (403 GitHub listings, 0 winnable). That would enforce the letter of the
 * rule while inverting its purpose.
 *
 * So the reference gates ASSERTION and SPEND, never EXPLORATION:
 *
 *   1. Explore freely      - no reference needed to enter the pipeline.
 *   2. Assert honestly     - without a reference a candidate may not claim
 *                            escrow, a precise reward, or a calibrated
 *                            probability. The estimate survives, labelled.
 *   3. Spend and claim     - a reference is required before real cost is
 *                            incurred and before any delivered/cleared claim.
 *
 * Nothing here rejects a candidate. A brand-new idea with no reference is a
 * HYPOTHESIS routed to NEEDS_EVIDENCE, which rankEconomicOpportunities already
 * prioritises ABOVE skip and setup-required.
 */

export const EVIDENCE_TIER = Object.freeze({
  /** No external artifact yet. Legitimate, and the raw material of discovery. */
  HYPOTHESIS: 'HYPOTHESIS',
  /** A checkable external artifact exists (listing, thread, order id). */
  REFERENCED: 'REFERENCED',
  /** An outcome has been verified against the ledger or a real artifact. */
  CONFIRMED: 'CONFIRMED'
});

/** Assertions a candidate may only make once something external backs it. */
export const PRECISION_FIELDS = Object.freeze(['escrow', 'rewardDollars', 'pSuccess']);

/**
 * Statuses asserting something about a COUNTERPARTY, which only an external
 * artifact can establish.
 *
 * TESTED_AND_READY is deliberately absent: it is an internal claim with
 * internal evidence (an actual `node --test` exit code, see
 * verifyDeliverableTests). Requiring a counterparty reference for it would
 * block honest work on an unexplored lane before anyone could be shown it.
 */
const OUTCOME_CLAIMS = Object.freeze([
  'DELIVERED', 'ACCEPTED', 'CLEARED', 'COMPLETED_AND_DELIVERED', 'INVOICED'
]);

const isHttpUrl = (value) => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch { return false; }
};

/**
 * A reference is any checkable external artifact — deliberately broad.
 *
 * A forum thread counts as readily as a bounty listing: demand signals are
 * where unexplored lanes start, and requiring a *listing* specifically is the
 * failure mode described above. What does NOT count is a generic label like
 * "Algora / GitHub OSS Bounty", which names a venue but identifies nothing.
 */
export function hasVerifiableReference(candidate = {}) {
  const url = candidate.sourceUrl || candidate.url || candidate.issueUrl || candidate.listingUrl;
  if (isHttpUrl(url)) return { ok: true, ref: String(url).trim() };

  const externalRef = candidate.externalRef || candidate.orderId || candidate.listingId;
  if (typeof externalRef === 'string' && externalRef.trim()) {
    return { ok: true, ref: externalRef.trim() };
  }

  if (url) return { ok: false, reason: `"${url}" is not a resolvable reference` };
  if (candidate.source) {
    return {
      ok: false,
      reason: `"${candidate.source}" is a generic source label, not a reference to a specific opportunity`
    };
  }
  return { ok: false, reason: 'no external reference supplied' };
}

export function classifyEvidenceTier(candidate = {}) {
  if (candidate.evidenceTier === EVIDENCE_TIER.CONFIRMED) return EVIDENCE_TIER.CONFIRMED;
  return hasVerifiableReference(candidate).ok ? EVIDENCE_TIER.REFERENCED : EVIDENCE_TIER.HYPOTHESIS;
}

/**
 * Type a candidate honestly. Never rejects — `rejected` is always false, and
 * exists so a caller reading this result cannot mistake it for a gate.
 */
export function normalizeCandidate(input = {}) {
  const candidate = { ...input };
  const reference = hasVerifiableReference(candidate);
  const tier = classifyEvidenceTier(candidate);
  const stripped = [];

  if (tier === EVIDENCE_TIER.HYPOTHESIS) {
    for (const field of PRECISION_FIELDS) {
      if (candidate[field] === undefined || candidate[field] === null) continue;
      // The estimate is preserved under an honest name rather than discarded -
      // it is still useful for ranking, it just is not a fact.
      if (field === 'rewardDollars') {
        candidate.unverifiedRewardEstimateDollars = candidate[field];
        candidate.rewardBasis = 'unverified_estimate';
      }
      candidate[field] = null;
      stripped.push(field);
    }
  }

  candidate.evidenceTier = tier;
  candidate.evidenceReference = reference.ok ? reference.ref : null;
  candidate.evidenceReason = reference.ok ? null : reference.reason;

  return {
    candidate,
    tier,
    stripped,
    rejected: false,
    decision: tier === EVIDENCE_TIER.HYPOTHESIS ? 'NEEDS_EVIDENCE' : 'ENTER'
  };
}

/** Investigation is free; real money is not. */
export function assertSpendAllowed(candidate = {}, { costCents = 0 } = {}) {
  if (costCents <= 0) return;
  const reference = hasVerifiableReference(candidate);
  if (!reference.ok) {
    throw new Error(
      `cannot spend ${costCents} cents on "${candidate.id ?? 'candidate'}" without a verifiable reference: ${reference.reason}`
    );
  }
}

/** An outcome claim needs something outside this process to be true. */
export function assertClaimAllowed(candidate = {}, status) {
  if (!OUTCOME_CLAIMS.includes(status)) return;
  const reference = hasVerifiableReference(candidate);
  if (!reference.ok) {
    throw new Error(
      `cannot claim ${status} for "${candidate.id ?? 'candidate'}" without a verifiable reference: ${reference.reason}`
    );
  }
}
