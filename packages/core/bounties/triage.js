import { detectInjection } from '../drones/injection.js';
import { checkRepoAiPolicy } from './policy.js';

export const TRIAGE_VERDICT = Object.freeze({
  VIABLE: 'VIABLE',
  REJECTED: 'REJECTED'
});

export const TRIAGE_GATE = Object.freeze({
  TRAP_CHECK: 'TRAP_CHECK',
  FUNDING_CHECK: 'FUNDING_CHECK',
  REACHABILITY_CHECK: 'REACHABILITY_CHECK',
  SCOPE_CHECK: 'SCOPE_CHECK',
  AI_POLICY_CHECK: 'AI_POLICY_CHECK'
});

// Keywords / phrases indicating human-only subjective judgement, design, or private staging requirements
const OUT_OF_SCOPE_PATTERNS = [
  /redesign\s+(the\s+)?(ui|ux|logo|homepage|landing\s+page|branding)/i,
  /product\s+(management|decision|strategy|vision)/i,
  /needs?\s+product\s+(input|decision|review)/i,
  /look\s+and\s+feel/i,
  /what\s+do\s+you\s+think\s+about/i,
  /needs?\s+(hardware|physical\s+device|raspberry\s+pi|ios\s+device|android\s+device)/i,
  /requires?\s+(access\s+to\s+)?(?:internal\s+)?(?:staging|vpn|cluster|private\s+vpn|production\s+db)/i,
  /(?:internal\s+staging|staging\s+vpn|private\s+cluster)/i,
  /call\s+with\s+(the\s+)?team/i,
  /interview\s+users?/i,
  /user\s+research/i,
  /sales\s+deck|pitch\s+deck/i,
  /calculate\s+the\s+exact\s+value\s+of\s+pi/i // Captured toy benchmark honeypots
];

// Keywords indicating geo-walls or restricted regional eligibility
const GEO_WALL_PATTERNS = [
  /us[\s-]only\b|united\s+states\s+citizens?\s+only/i,
  /eu[\s-]residents?\s+only/i,
  /must\s+be\s+located\s+in\s+the\s+(us|eu|uk)/i,
  /requires?\s+(us|eu)\s+bank\s+account/i
];

// Patterns for extracting explicit monetary rewards
const REWARD_EXTRACTORS = [
  /(?:bounty|reward|prize):\s*\$([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
  /\$([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?)\s*(?:bounty|reward|on\s+algora|on\s+polar)/i,
  /bounty=([0-9]+)/i,
  /reward=([0-9]+)/i,
  /algora\.io\/[^\s]+?bounty=([0-9]+)/i,
  /polar\.sh\/[^\s]+?reward=([0-9]+)/i
];

/**
 * Parses numeric USD reward from issue title, body, or payload.
 */
export function extractBountyReward(listing = {}) {
  const direct = listing.rewardUsd ?? listing.reward ?? listing.bountyUsd ?? listing.bounty;
  if (direct != null && Number.isFinite(Number(direct)) && Number(direct) > 0) {
    return Number(direct);
  }

  const text = `${listing.title || ''} ${listing.body || ''} ${listing.description || ''} ${listing.url || ''} ${listing.html_url || ''}`;
  for (const regex of REWARD_EXTRACTORS) {
    const match = text.match(regex);
    if (match) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (Number.isFinite(val) && val > 0) return val;
    }
  }


  return null;
}

/**
 * Deterministically triages an incoming bounty listing.
 *
 * @param {Object} listing
 * @param {string} listing.title
 * @param {string} [listing.body]
 * @param {string} [listing.repo]
 * @param {string} [listing.url]
 * @param {string|Record<string, string>} [listing.contributingText]
 * @param {number} [minRewardUsd=5]
 * @returns {{
 *   verdict: 'VIABLE'|'REJECTED',
 *   failedGate: string|null,
 *   reason: string,
 *   evidence: Object
 * }}
 */
export function triageBountyListing(listing = {}, { minRewardUsd = 5 } = {}) {
  const title = listing.title || '';
  const body = listing.body || listing.description || '';
  const repo = listing.repo || '';
  const url = listing.url || listing.html_url || '';
  const fullText = `${title}\n\n${body}`;

  // Gate 1: TRAP_CHECK — Reject prompt exfiltration & instruction injection (#193)
  const injection = detectInjection(fullText);
  if (injection.detected) {
    return {
      verdict: TRIAGE_VERDICT.REJECTED,
      failedGate: TRIAGE_GATE.TRAP_CHECK,
      reason: `Prompt injection or honeypot signature detected: ${injection.matches.join(' | ')}`,
      evidence: { matches: injection.matches }
    };
  }

  // Gate 2: FUNDING_CHECK — Verify non-trivial funded escrow
  const rewardUsd = extractBountyReward(listing);
  const hasPlatformBadge = /(?:algora|polar\.sh|gitcoin|bountycaster|opire)/i.test(fullText) ||
                           /(?:algora|polar\.sh|gitcoin)/i.test(url);

  if (rewardUsd == null && !hasPlatformBadge) {
    return {
      verdict: TRIAGE_VERDICT.REJECTED,
      failedGate: TRIAGE_GATE.FUNDING_CHECK,
      reason: 'No verified bounty escrow evidence or monetary reward figure found; bare label or intent only',
      evidence: { rewardUsd, hasPlatformBadge }
    };
  }

  if (rewardUsd != null && rewardUsd < minRewardUsd) {
    return {
      verdict: TRIAGE_VERDICT.REJECTED,
      failedGate: TRIAGE_GATE.FUNDING_CHECK,
      reason: `Bounty reward ($${rewardUsd.toFixed(2)}) is below minimum threshold ($${minRewardUsd.toFixed(2)})`,
      evidence: { rewardUsd, minRewardUsd }
    };
  }

  // Gate 3: REACHABILITY_CHECK — Filter geo-walls and platform account walls
  for (const pattern of GEO_WALL_PATTERNS) {
    const match = fullText.match(pattern);
    if (match) {
      return {
        verdict: TRIAGE_VERDICT.REJECTED,
        failedGate: TRIAGE_GATE.REACHABILITY_CHECK,
        reason: `Geographic restriction or regional prerequisite: "${match[0]}"`,
        evidence: { matched: match[0] }
      };
    }
  }

  // Gate 4: SCOPE_CHECK — Reject subjective design, product decisions, private staging
  for (const pattern of OUT_OF_SCOPE_PATTERNS) {
    const match = fullText.match(pattern);
    if (match) {
      return {
        verdict: TRIAGE_VERDICT.REJECTED,
        failedGate: TRIAGE_GATE.SCOPE_CHECK,
        reason: `Out of scope for autonomous coding agent (requires subjective design, product consensus, hardware, or private staging): "${match[0]}"`,
        evidence: { matched: match[0] }
      };
    }
  }

  // Gate 5: AI_POLICY_CHECK — Reject repositories with AI bans (#194)
  if (listing.contributingText) {
    const policyResult = checkRepoAiPolicy({
      contributingText: listing.contributingText,
      repo
    });
    if (!policyResult.allowed) {
      return {
        verdict: TRIAGE_VERDICT.REJECTED,
        failedGate: TRIAGE_GATE.AI_POLICY_CHECK,
        reason: `Target repository prohibits AI contributions: ${policyResult.reason}`,
        evidence: { policyRef: policyResult.policyRef, verdict: policyResult.verdict }
      };
    }
  }

  return {
    verdict: TRIAGE_VERDICT.VIABLE,
    failedGate: null,
    reason: `Self-contained code fix with verified funding evidence ($${(rewardUsd || 0).toFixed(2)}) and clean policy clearance.`,
    evidence: {
      rewardUsd,
      hasPlatformBadge,
      repo
    }
  };
}
