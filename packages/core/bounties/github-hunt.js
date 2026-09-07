/**
 * Qualifies GitHub bounty listings into ones a solo operator in India can
 * actually get paid for.
 *
 * Measured on 2026-09-07 against five live GitHub search queries: 11,902 total
 * matches, 403 pulled, 22 survived repo-health filtering, and of those 22 a
 * further six were false positives from two repositories. The filters below are
 * each written against a specific failure seen in that measurement, not against
 * a guess about what spam looks like.
 */

/** Repos that republish other people's bounties. Their dollar figures are quotes, not offers. */
const AGGREGATOR = /bounty-plaza|bountyscout|aggregat|^awesome-|-list$|mirror/i;

/**
 * Catalogues of offers. sourcey/startup-credits produced four of the top ten
 * hits at $18,000, $10,000 and two at $1,000 — every one of them the face value
 * of a startup credit being recorded in a YAML file, none of them payable to
 * whoever files the issue. Value in the body does not mean value to us.
 */
const CATALOGUE = /startup-credits|credits-catalog|\bcatalog(ue)?\b.*\b(offer|credit)s?\b/i;

/**
 * Bounty farms: young repos paying implausible sums for trivial or decorative
 * work. SecureBananaLabs/bug-bounty offered $780 for "gold coin pixel art" and
 * $430 for a poem. A real $780 task is not decorative, so the tell is the pair
 * — high amount, low-skill deliverable — not either half alone.
 */
const TRIVIAL_DELIVERABLE = /pixel art|\bpoem\b|\bwallpaper\b|\bsticker\b|add (a )?readme|fix typo|logo design/i;
const FARM_AMOUNT_FLOOR = 200;

/**
 * Work that can only be verified on hardware the operator does not have. Submitting
 * a kernel fix you cannot run is guesswork, and these bounties pay on a passing
 * test, not on a plausible diff. Narrow on purpose: only named accelerators and
 * boards, never generic words like "GPU" that appear in ordinary software.
 */
const HARDWARE_GATES = [
  { name: 'Tenstorrent Wormhole/Blackhole', re: /\b(wormhole|blackhole)\b/i },
  { name: 'FPGA bitstream', re: /\b(fpga|bitstream|verilog|vhdl)\b/i },
  { name: 'a physical robotics/embedded rig', re: /\b(oscilloscope|logic analyzer|jtag probe|dev board)\b/i }
];

/**
 * Someone else's claim on a bounty, not an offer of one. The live hunt ranked
 * "[BOUNTY CLAIM] gaussagent High-Value Bounty Request" first at $15,000 — a
 * contributor asking to be paid for work already done. Working that listing
 * competes with a claim that is ahead of us.
 */
const ALREADY_CLAIMED = /\[?bounty claim\]?|claiming this|claimed by|assigned to @/i;

const MONEY = /(?:\$|USD\s*)\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/g;

/** Rails, and what each actually leaves in the operator's hand. */
export const RAILS = {
  paypal: { key: 'paypal', reachesIndia: true, retention: 0.906, note: 'PayPal international: 4.4% + 3.5% FX.' },
  crypto: { key: 'crypto', reachesIndia: true, retention: 0.69, note: 'India VDA: 30% tax + 1% TDS.' },
  algora: { key: 'algora', reachesIndia: false, retention: 0, note: 'Stripe Express plus terms prohibiting robotic access.' },
  unstated: { key: 'unstated', reachesIndia: null, retention: 0.906, note: 'Rail not stated in the listing; ask before working.' }
};

export function detectRail(text) {
  if (/algora/i.test(text)) return RAILS.algora;
  if (/paypal/i.test(text)) return RAILS.paypal;
  if (/USDC|\bETH\b|wallet|crypto|token/i.test(text)) return RAILS.crypto;
  return RAILS.unstated;
}

/** Largest credible figure in the text. Sub-$50 is noise; over $20k in an issue body is nearly always a quote. */
export function extractAmount(text, { floor = 50, ceiling = 20000 } = {}) {
  const found = [...text.matchAll(MONEY)]
    .map((m) => parseFloat(m[1].replace(/,/g, '')))
    .filter((v) => v >= floor && v <= ceiling);
  return found.length ? Math.max(...found) : null;
}

/**
 * Returns a rejection reason, or null when the listing qualifies. Reasons are
 * returned rather than a boolean so a rejected listing can be argued with.
 */
export function disqualify(listing, { now = new Date(), minStars = 40, maxIdleDays = 90 } = {}) {
  const { repoFullName, stars, pushedAt, title = '', body = '' } = listing;
  const text = `${title} ${body}`;

  if (AGGREGATOR.test(repoFullName)) return 'aggregator: republishes bounties it does not fund';
  if (CATALOGUE.test(repoFullName)) return 'catalogue: amounts are recorded offers, not payable bounties';
  if (!(stars >= minStars)) return `thin repo: ${stars} stars, below ${minStars}`;

  const idleDays = (now.getTime() - Date.parse(pushedAt)) / 86_400_000;
  if (!(idleDays <= maxIdleDays)) return `stale repo: last push ${Math.round(idleDays)} days ago`;

  if (ALREADY_CLAIMED.test(title)) return 'already claimed: another contributor is ahead of us';

  // Winnability, learned from tenstorrent/tt-metal #55502 on 2026-09-07: a real
  // $5,000 bounty at a real company that was nonetheless unwinnable because it
  // was assigned, already had two solution PRs, and needed hardware we do not
  // have. A bounty is not an opportunity until someone can actually land it.
  if (listing.assignee) return `assigned: already claimed by @${listing.assignee}`;
  if (listing.competingPrs >= 1)
    return `contested: ${listing.competingPrs} solution PR(s) already open`;
  const gate = HARDWARE_GATES.find((h) => h.re.test(text));
  if (gate) return `hardware-gated: needs ${gate.name}, which the operator cannot test on`;

  const amount = extractAmount(text);
  if (amount === null) return 'no credible amount stated';
  if (amount >= FARM_AMOUNT_FLOOR && TRIVIAL_DELIVERABLE.test(text))
    return `farm signature: $${amount} for a trivial deliverable`;

  const rail = detectRail(text);
  if (rail.reachesIndia === false) return `rail unreachable: ${rail.note}`;

  return null;
}

/** Qualified listings, best expected net first. */
export function qualify(listings, options = {}) {
  const kept = [];
  const rejected = [];
  for (const listing of listings) {
    const reason = disqualify(listing, options);
    if (reason) { rejected.push({ ...listing, reason }); continue; }
    const text = `${listing.title || ''} ${listing.body || ''}`;
    const gross = extractAmount(text);
    const rail = detectRail(text);
    kept.push({ ...listing, gross, rail: rail.key, net: Math.round(gross * rail.retention) });
  }
  kept.sort((a, b) => b.net - a.net);
  return { qualified: kept, rejected };
}

/** The five queries measured to return live bounty listings. */
export const HUNT_QUERIES = [
  'state:open label:bounty',
  'state:open in:body "bounty" in:body "USD"',
  'state:open label:reward',
  'state:open in:body "paypal" in:body "bounty"',
  'state:open label:"help wanted" in:body "we will pay"'
];
