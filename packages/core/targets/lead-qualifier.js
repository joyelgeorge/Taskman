/**
 * Is this repo a real business worth securing, or a toy where a vulnerability
 * doesn't matter? A confirmed bug is only a LEAD when someone has users, money,
 * or a reputation at stake — nobody pays to harden a tutorial clone or a
 * one-commit weekend project. This gate runs BEFORE outreach so effort (and the
 * disclosure email) only goes to repos where the fix is worth paying for.
 *
 * Metadata-first so most repos are judged without cloning; optional code signals
 * (payments, auth) sharpen the call once a repo is already being scanned.
 */

// Names/descriptions that announce the repo is not a business: learning
// material, scaffolding, throwaways. A vuln in these is real but unsellable.
const NOT_A_BUSINESS = /\b(template|starter|boilerplate|scaffold|tutorial|course|demo|example|sample|playground|sandbox|test[-_ ]?app|hello[-_ ]?world|clone|portfolio|my[-_ ]?first|learning|practice|todo[-_ ]?app|workshop|assignment|homework|poc|proof[-_ ]of[-_ ]concept)\b/i;

// Code-level tells that a product has users and money moving through it.
export const BUSINESS_CODE_SIGNALS = {
  payments: /\b(stripe|paddle|lemonsqueezy|lemon-squeezy|razorpay|paypal|braintree|chargebee)\b/i,
  auth: /\b(supabase\.auth|next-auth|@clerk|clerk|@auth0|auth0|lucia-auth|better-auth)\b/i
};

function daysBetween(a, b) { return Math.abs(new Date(a) - new Date(b)) / 86400000; }

/**
 * @param repo GitHub metadata: name, full_name, description, homepage,
 *   stargazers_count, forks_count, archived, fork, created_at, pushed_at, has_pages
 * @param code optional { hasPayments, hasAuth, readmeChars }
 * @returns { genuine, score, reasons, rejections }
 */
export function qualifyLead(repo = {}, code = {}) {
  const reasons = [];
  const rejections = [];
  const text = `${repo.name || ''} ${repo.description || ''}`;

  // Hard rejections — not a business, or unreachable to disclose to.
  if (repo.archived) rejections.push('archived — not maintained');
  if (repo.fork) rejections.push('a fork, not an original product');
  if (NOT_A_BUSINESS.test(text)) rejections.push(`name/description reads as non-business ("${(text.match(NOT_A_BUSINESS) || [])[0]}")`);

  // Positive evidence of a real, used product.
  let score = 0;
  const deployed = Boolean((repo.homepage && /^https?:\/\//.test(repo.homepage)) || repo.has_pages);
  if (deployed) { score += 0.4; reasons.push('has a live deployment / homepage'); }
  if ((repo.stargazers_count || 0) >= 5) { score += 0.2; reasons.push(`${repo.stargazers_count} stars`); }
  if ((repo.forks_count || 0) >= 2) { score += 0.1; reasons.push(`${repo.forks_count} forks`); }
  if (repo.created_at && repo.pushed_at && daysBetween(repo.created_at, repo.pushed_at) >= 30) {
    score += 0.15; reasons.push('sustained over 30+ days, not a one-day dump');
  }
  if ((repo.description || '').length >= 25) { score += 0.05; reasons.push('has a real description'); }
  if (code.hasPayments) { score += 0.35; reasons.push('payment integration in code — money at stake'); }
  if (code.hasAuth) { score += 0.15; reasons.push('auth in code — has user accounts'); }

  score = Math.round(Math.min(score, 1) * 100) / 100;
  // Genuine = no hard rejection AND real evidence of use. A live deployment or
  // payments alone clears it; otherwise it needs enough combined signal.
  const genuine = rejections.length === 0 && (deployed || code.hasPayments || score >= 0.45);
  return { genuine, score, reasons, rejections };
}
