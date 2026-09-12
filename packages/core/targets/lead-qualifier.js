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
/**
 * Words that name the artifact as a toy. These are unambiguous: no real product
 * describes itself as a boilerplate.
 */
const UNAMBIGUOUS_TOY = /\b(template|starter|boilerplate|scaffold|hello[-_ ]?world|my[-_ ]?first|todo[-_ ]?app|assignment|homework|poc|proof[-_ ]of[-_ ]concept|test[-_ ]?app)\b/i;

/**
 * Words that are ordinary DOMAIN VOCABULARY as often as they are toy signals.
 *
 * The 2026-09-12 sweep threw away its best lead — a real company, custom domain,
 * sustained development, four critical findings — because its description read
 * "portfolio optimization" and `portfolio` was on the reject list. Measured
 * against ten plausible business descriptions, the old single list rejected
 * nine: portfolio optimization, machine learning, course marketplace, practice
 * management, sample tracking, workshop booking, demo day.
 *
 * `learning` was the most expensive of them, in a market defined as AI-built
 * apps.
 *
 * So these reject only when nothing else says the repo is a real product, and
 * they still reject outright when they name the repo itself — "my-portfolio"
 * names the artifact, "portfolio optimization" describes a domain.
 */
const AMBIGUOUS_TOY = /\b(tutorial|course|demo|example|sample|playground|sandbox|clone|portfolio|learning|practice|workshop)\b/i;

/** Hosting subdomains: present for toys and products alike, so they prove nothing. */
const PLATFORM_HOST = /\.(github\.io|vercel\.app|netlify\.app|pages\.dev|herokuapp\.com|onrender\.com|web\.app|firebaseapp\.com|surge\.sh|repl\.co)$/i;

/**
 * A custom domain is somebody paying a registrar for this specific thing, which
 * is the cheapest honest signal that a product is real.
 */
function hasCustomDomain(homepage) {
  if (!homepage || !/^https?:\/\//.test(homepage)) return false;
  try { return !PLATFORM_HOST.test(new URL(homepage).hostname); } catch { return false; }
}

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
  const unambiguous = text.match(UNAMBIGUOUS_TOY);
  if (unambiguous) rejections.push(`names itself a toy ("${unambiguous[0]}")`);

  // An ambiguous word naming the repo is a toy signal; the same word inside a
  // description may simply be the business's subject matter.
  const ambiguousInName = (repo.name || '').match(AMBIGUOUS_TOY);
  if (ambiguousInName) rejections.push(`repo name reads as non-business ("${ambiguousInName[0]}")`);

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

  // Strong evidence that somebody is running this as a product: a domain they
  // pay for, or money moving through the code.
  const strongEvidence = hasCustomDomain(repo.homepage) || Boolean(code.hasPayments);
  if (hasCustomDomain(repo.homepage)) reasons.push('custom domain — somebody pays a registrar for this');

  // An ambiguous word in the description only rejects when nothing else argues
  // the repo is real. "portfolio optimization" on a custom domain is a business;
  // "a demo of what I learned" with no deployment is not.
  const ambiguousInDescription = (repo.description || '').match(AMBIGUOUS_TOY);
  if (ambiguousInDescription && !strongEvidence) {
    rejections.push(`description reads as non-business ("${ambiguousInDescription[0]}") `
      + 'with no custom domain or payment integration to argue otherwise');
  }

  score = Math.round(Math.min(score, 1) * 100) / 100;
  const genuine = rejections.length === 0 && (deployed || code.hasPayments || score >= 0.45);
  return { genuine, score, reasons, rejections };
}
