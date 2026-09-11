/**
 * Money-Making AI Engine & Specialist Agent
 * Encapsulates specialized strategies, prompts, and deterministic validation for economic workflows.
 */

export const MONEY_DOMAINS = {
  OPPORTUNITY_TRIAGE: 'OPPORTUNITY_TRIAGE',
  FEE_LEAKAGE_AUDIT: 'FEE_LEAKAGE_AUDIT',
  CANDIDATE_DELIVERABLE: 'CANDIDATE_DELIVERABLE',
  MARKET_ARBITRAGE: 'MARKET_ARBITRAGE'
};

export const DOMAIN_SYSTEM_PROMPTS = {
  [MONEY_DOMAINS.OPPORTUNITY_TRIAGE]: `You are an elite, risk-averse Economic Triage Intelligence.
Your purpose: Analyze incoming opportunities (bounties, gigs, contracts) and determine whether they represent viable, positive-ROI paths.
You prioritize deterministic constraints, verified funding proof, absence of trap/exfiltration prompts, and clear deliverables.
Output strict JSON matching the requested schema.`,

  [MONEY_DOMAINS.FEE_LEAKAGE_AUDIT]: `You are a specialized Financial Reconciliation and Fee Recovery Auditor.
Your purpose: Inspect transaction rows, fee structures, marketplace settlements, and identify verifiable discrepancies or clawback candidates.
Never invent numbers. Provide exact line items, discrepancy amounts, and audit evidence citations.
Output strict JSON matching the requested schema.`,

  [MONEY_DOMAINS.CANDIDATE_DELIVERABLE]: `You are a high-precision Autonomous Execution Specialist.
Your purpose: Generate production-ready candidate solutions, clean code changes, or comprehensive audit reports for human review.
Ensure strict adherence to acceptance criteria, minimal diffs, and transparent disclosure.
Output strict JSON or structured markdown.`
};

/**
 * Builds a structured prompt for the Money-Making AI.
 */
export function buildMoneyPrompt({ domain, context = {}, objective = '' }) {
  const systemPrompt = DOMAIN_SYSTEM_PROMPTS[domain] || DOMAIN_SYSTEM_PROMPTS[MONEY_DOMAINS.OPPORTUNITY_TRIAGE];

  let userPrompt = `Domain: ${domain}\nObjective: ${objective}\n\nContext Data:\n${JSON.stringify(context, null, 2)}\n\n`;

  if (domain === MONEY_DOMAINS.OPPORTUNITY_TRIAGE) {
    userPrompt += `Analyze this opportunity. Evaluate:
1. Feasibility (0.0 to 1.0)
2. Payout Certainty & Verified Escrow
3. Estimated Cost & Time
4. Trap / Exfiltration Risk (Boolean)
5. Decision: "ENTER", "REJECT", or "NEEDS_EVIDENCE"
6. Concise Reasoning

Format your response as valid JSON:
{
  "decision": "ENTER" | "REJECT" | "NEEDS_EVIDENCE",
  "feasibilityScore": number,
  "estimatedPayoutUsd": number,
  "trapDetected": boolean,
  "reasons": string[]
}`;
  } else if (domain === MONEY_DOMAINS.FEE_LEAKAGE_AUDIT) {
    userPrompt += `Analyze the provided transaction records for fee leakage or overcharges.
Format your response as valid JSON:
{
  "totalLeakageUsd": number,
  "confidence": number,
  "recoverableItems": [
    { "id": string, "type": string, "amountUsd": number, "evidence": string }
  ],
  "recommendations": string[]
}`;
  }

  return {
    systemPrompt,
    userPrompt
  };
}

/**
 * Validates and normalizes the AI output.
 */
export function evaluateMoneyAiOutput(domain, rawOutput) {
  if (!rawOutput || typeof rawOutput !== 'string') {
    return { ok: false, error: 'Empty AI response' };
  }

  let parsed;
  try {
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawOutput);
  } catch (err) {
    return { ok: false, error: 'Failed to parse JSON from AI output', raw: rawOutput };
  }

  if (domain === MONEY_DOMAINS.OPPORTUNITY_TRIAGE) {
    if (!parsed.decision || !['ENTER', 'REJECT', 'NEEDS_EVIDENCE'].includes(parsed.decision)) {
      return { ok: false, error: 'Invalid decision in triage output', parsed };
    }
    return {
      ok: true,
      decision: parsed.decision,
      feasibilityScore: Number(parsed.feasibilityScore) || 0,
      estimatedPayoutUsd: Number(parsed.estimatedPayoutUsd) || 0,
      trapDetected: Boolean(parsed.trapDetected),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons : []
    };
  }

  if (domain === MONEY_DOMAINS.FEE_LEAKAGE_AUDIT) {
    return {
      ok: true,
      totalLeakageUsd: Number(parsed.totalLeakageUsd) || 0,
      confidence: Number(parsed.confidence) || 0,
      recoverableItems: Array.isArray(parsed.recoverableItems) ? parsed.recoverableItems : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : []
    };
  }

  return { ok: true, parsed };
}
