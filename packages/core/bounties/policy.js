/**
 * Repository AI Contribution Policy Checker & Disclosure Generator (Issue #194)
 *
 * Background:
 * - Algora terms prohibit automated / robotic submissions to its platform.
 * - Maintainers across open-source have established strict AI contribution policies:
 *   37+ ban AI contributions outright (curl, Ghostty, tldraw, Codeberg), while
 *   72+ allow them only with explicit disclosure.
 * - This module inspects repository contributing texts (CONTRIBUTING.md, AI.md, etc.)
 *   and fails closed if AI contributions are banned. If permitted, it mandates standard
 *   human-in-the-loop disclosure text.
 */

export const AI_POLICY_VERDICT = Object.freeze({
  BANNED: 'BANNED',
  ALLOWED_WITH_CONDITIONS: 'ALLOWED_WITH_CONDITIONS',
  UNRESTRICTED: 'UNRESTRICTED'
});

export const STANDARD_DISCLOSURE_TEXT = 
  'This contribution was drafted with AI assistance (Taskman). Reviewed, verified, and submitted by a human operator.';

// Phrases indicating strict prohibition of AI contributions or PRs
const BAN_PATTERNS = [
  /no\s+ai\b/i,
  /ai\s+(?:code|contributions?|prs?|pull\s+requests?)\s+(?:is|are)\s+not\s+(?:accepted|permitted|allowed)/i,
  /ai\s+(?:code|contributions?|prs?|pull\s+requests?)\s+(?:is|are)\s+(?:strictly\s+)?prohibited/i,
  /ai[\s-]generated\s+(?:code|prs?|pull\s+requests?|contributions?|submissions?)\s+(?:is|are)\s+(?:strictly\s+)?prohibited/i,
  /prohibit(?:s|ed|ing)?\s+(?:the\s+use\s+of\s+)?ai\b/i,
  /ban(?:s|ned)?\s+ai\b/i,
  /zero[\s-]tolerance\s+for\s+ai/i,
  /ai[\s-]generated\s+content\s+is\s+forbidden/i,
  /do\s+not\s+submit\s+ai[\s-]generated/i,
  /we\s+do\s+not\s+accept\s+(?:any\s+)?ai/i,
  /disallow(?:s|ed)?\s+ai[\s-]generated/i
];


// Phrases indicating allowed with conditions (disclosure, prior approval, etc.)
const CONDITIONAL_PATTERNS = [
  /disclose\s+(?:any\s+)?ai/i,
  /ai[\s-]assisted\s+contributions?\s+must\s+be\s+disclosed/i,
  /with\s+(?:explicit\s+)?disclosure/i,
  /pre[\s-]approved\s+issues?\s+only/i,
  /must\s+state\s+whether\s+ai\s+was\s+used/i
];

/**
 * Checks repository files/text against AI contribution policies.
 *
 * @param {Object} options
 * @param {string|Record<string, string>} [options.contributingText] - Raw text or map of files
 * @param {string} [options.repo] - Repo slug (e.g. "org/repo")
 * @returns {{
 *   allowed: boolean,
 *   verdict: string,
 *   reason: string,
 *   policyRef: string|null,
 *   disclosureText: string|null
 * }}
 */
export function checkRepoAiPolicy({ contributingText = '', repo = '' } = {}) {
  let combinedText = '';

  if (typeof contributingText === 'string') {
    combinedText = contributingText;
  } else if (contributingText && typeof contributingText === 'object') {
    combinedText = Object.entries(contributingText)
      .map(([filename, content]) => `--- ${filename} ---\n${content}`)
      .join('\n\n');
  }

  const trimmed = combinedText.trim();

  // If no policy files found or empty, default to ALLOWED_WITH_CONDITIONS with mandatory disclosure
  if (!trimmed) {
    return {
      allowed: true,
      verdict: AI_POLICY_VERDICT.ALLOWED_WITH_CONDITIONS,
      reason: 'No explicit AI policy found; adhering to responsible disclosure baseline.',
      policyRef: null,
      disclosureText: STANDARD_DISCLOSURE_TEXT
    };
  }

  // 1. Check for outright bans
  for (const pattern of BAN_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const matchIndex = match.index || 0;
      const start = Math.max(0, matchIndex - 40);
      const end = Math.min(trimmed.length, matchIndex + match[0].length + 60);
      const snippet = trimmed.slice(start, end).replace(/\s+/g, ' ').trim();

      return {
        allowed: false,
        verdict: AI_POLICY_VERDICT.BANNED,
        reason: `Target repository explicitly prohibits AI contributions (${pattern.toString()}).`,
        policyRef: snippet,
        disclosureText: null
      };
    }
  }

  // 2. Check for conditional policies
  for (const pattern of CONDITIONAL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const matchIndex = match.index || 0;
      const start = Math.max(0, matchIndex - 40);
      const end = Math.min(trimmed.length, matchIndex + match[0].length + 60);
      const snippet = trimmed.slice(start, end).replace(/\s+/g, ' ').trim();

      return {
        allowed: true,
        verdict: AI_POLICY_VERDICT.ALLOWED_WITH_CONDITIONS,
        reason: 'Repository allows AI-assisted contributions with mandatory disclosure.',
        policyRef: snippet,
        disclosureText: STANDARD_DISCLOSURE_TEXT
      };
    }
  }

  // Baseline safe default: Always require disclosure
  return {
    allowed: true,
    verdict: AI_POLICY_VERDICT.ALLOWED_WITH_CONDITIONS,
    reason: 'Repository policy does not forbid AI; standard human-review disclosure required.',
    policyRef: null,
    disclosureText: STANDARD_DISCLOSURE_TEXT
  };
}
