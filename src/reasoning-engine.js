import { providerStatus, runWithFallback } from './providers.js';
import { validateSchema } from './reasoning-schemas.js';
import { stableErrorCode } from './errors.js';
import { getRuntimeConfig } from './config.js';

export class ReasoningEngine {
  constructor({ enabled = getRuntimeConfig().reasoningEnabled } = {}) {
    this.enabled = enabled;
  }

  isConfigured() {
    if (!this.enabled) return false;
    const status = providerStatus();
    return status.some(p => p.ready);
  }

  /**
   * Dispatches a structured prompt to available providers, parses JSON, and validates schema.
   */
  async reason({ systemPrompt = '', prompt = '', schemaName = null, mockProvider = null }) {
    if (!this.enabled && !mockProvider) {
      return { ok: false, reason: 'Reasoning engine is disabled via TASKMAN_REASONING_ENABLED=false' };
    }

    const fullPrompt = `${systemPrompt ? systemPrompt + '\n\n' : ''}Strictly return only valid raw JSON matching the required schema.\n\n${prompt}`;

    let result;
    if (typeof mockProvider === 'function') {
      const started = Date.now();
      const raw = await mockProvider(fullPrompt);
      result = {
        text: typeof raw === 'string' ? raw : JSON.stringify(raw),
        inputTokens: 10,
        outputTokens: 20,
        provider: 'mock',
        model: 'mock-model',
        latencyMs: Date.now() - started
      };
    } else {
      try {
        result = await runWithFallback(fullPrompt);
      } catch (err) {
        return { ok: false, error: stableErrorCode(err, 'PROVIDER_UNAVAILABLE'), fallbacks: err.diagnostics || [] };
      }
    }

    // Parse JSON
    let parsed;
    try {
      // Clean potential code block wrapping
      const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      parsed = JSON.parse(cleaned);
    } catch {
      return { ok: false, error: 'MODEL_OUTPUT_INVALID' };
    }

    // Validate schema if requested
    if (schemaName) {
      const schemaCheck = validateSchema(parsed, schemaName);
      if (!schemaCheck.valid) {
        return { ok: false, error: 'MODEL_OUTPUT_INVALID' };
      }
    }

    return {
      ok: true,
      data: parsed,
      meta: {
        provider: result.provider,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs
      }
    };
  }

  /**
   * Discovery synthesis stage
   */
  async synthesizeDiscovery({ sourceEvidence = [], existingHypotheses = [], mockProvider = null } = {}) {
    if (sourceEvidence.length === 0) {
      return { ok: true, data: { candidates: [] }, note: 'No source evidence provided, synthesizing 0 candidates' };
    }

    const prompt = `You are the Taskman Discovery Reasoning Agent.
Analyze the following real source evidence and synthesize candidate money-making opportunities.
Do NOT fabricate sources or fake opportunities. Only synthesize candidates derived directly from the provided evidence.

Real Source Evidence:
${JSON.stringify(sourceEvidence, null, 2)}

Existing Hypotheses / Prior Research:
${JSON.stringify(existingHypotheses, null, 2)}

Return a JSON object with:
{
  "candidates": [
    {
      "candidateId": "unique-id",
      "title": "Clear opportunity title",
      "noveltyKey": "deterministic-key",
      "profile": "programmable_money_flow_v1" | "bounty_execution_v1",
      "metrics": {
        "flowScale": 0-1,
        "recurrence": 0-1,
        "triggerIndependence": 0-1,
        "permission": 0-1,
        "deltaMeasurability": 0-1,
        "monetization": 0-1,
        "executionAutonomy": 0-1,
        "competitiveWhitespace": 0-1,
        "setupBurden": 0-1,
        "timeToMoney": 0-1
      },
      "evidence": ["cited URL or reference string"],
      "gateEvidence": {
        "money_flow_scale": { "verdict": "pass"|"fail"|"uncertain", "evidenceRef": "string" }
      },
      "requiredCapabilities": ["web.read"]
    }
  ]
}`;

    return this.reason({
      prompt,
      schemaName: 'discovery_synthesis',
      mockProvider
    });
  }

  /**
   * Evidence Gap Planning for Validation
   */
  async planEvidenceGaps({ candidate = {}, mockProvider = null } = {}) {
    const prompt = `You are the Taskman Evidence Gap Planner.
Examine this candidate and identify missing or stale facts before proceeding to external research.

Candidate:
${JSON.stringify(candidate, null, 2)}

Return JSON:
{
  "missingFacts": ["list of specific facts missing evidence"],
  "staleFacts": ["facts needing fresh verification"],
  "needsFreshSearch": true|false,
  "targetedSearchQueries": ["query 1", "query 2"]
}`;

    return this.reason({
      prompt,
      schemaName: 'evidence_gap_plan',
      mockProvider
    });
  }

  /**
   * Adversarial Gate Validation
   */
  async validateAdversarial({ candidate = {}, freshEvidence = [], mockProvider = null } = {}) {
    const prompt = `You are the Taskman Adversarial Validator.
Attack this candidate against 8 money-flow gates. Every gate MUST have its own concrete cited evidence reference.

Candidate:
${JSON.stringify(candidate, null, 2)}

Fresh Evidence:
${JSON.stringify(freshEvidence, null, 2)}

Return JSON:
{
  "adversarialRisks": ["identified failure modes"],
  "gateEvidence": {
    "money_flow_scale": { "verdict": "pass"|"fail"|"uncertain", "evidenceRef": "specific URL/fact" },
    "recurring_leakage": { "verdict": "pass"|"fail"|"uncertain", "evidenceRef": "specific URL/fact" },
    "independent_trigger": { "verdict": "pass"|"fail"|"uncertain", "evidenceRef": "specific URL/fact" },
    "permission_non_invasive": { "verdict": "pass"|"fail"|"uncertain", "evidenceRef": "specific URL/fact" },
    "measurable_delta": { "verdict": "pass"|"fail"|"uncertain", "evidenceRef": "specific URL/fact" },
    "monetization": { "verdict": "pass"|"fail"|"uncertain", "evidenceRef": "specific URL/fact" },
    "no_transaction_ownership": { "verdict": "pass"|"fail"|"uncertain", "evidenceRef": "specific URL/fact" },
    "competitive_whitespace": { "verdict": "pass"|"fail"|"uncertain", "evidenceRef": "specific URL/fact" }
  }
}`;

    return this.reason({
      prompt,
      schemaName: 'adversarial_validation',
      mockProvider
    });
  }

  /**
   * Structured Action Planning for Execution
   */
  async planExecution({ candidate = {}, availableCapabilities = [], mockProvider = null } = {}) {
    const prompt = `You are the Taskman Execution Planner.
Generate a structured, safe execution plan strictly constrained by available capabilities.

Candidate:
${JSON.stringify(candidate, null, 2)}

Available Capabilities:
${JSON.stringify(availableCapabilities, null, 2)}

Return JSON:
{
  "actionSummary": "Description of next safe executable step",
  "requiredAdapters": ["adapter1", "adapter2"],
  "steps": [
    { "order": 1, "action": "exact action", "capability": "cap_name" }
  ],
  "isBlocked": true|false,
  "blockedReason": "optional reason if missing required adapter"
}`;

    return this.reason({
      prompt,
      schemaName: 'execution_plan',
      mockProvider
    });
  }
}

export const sharedReasoningEngine = new ReasoningEngine();
