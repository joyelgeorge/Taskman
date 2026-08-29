/**
 * AI Reasoning Engine JSON Schemas & Validation
 * Enforces structured schema validation on all LLM responses before any system mutation.
 */

export function validateSchema(data, schemaName) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Output must be a non-null object' };
  }

  switch (schemaName) {
    case 'discovery_synthesis':
      if (!Array.isArray(data.candidates)) {
        return { valid: false, error: 'discovery_synthesis requires candidates array' };
      }
      for (const c of data.candidates) {
        if (!c.title || typeof c.title !== 'string') return { valid: false, error: 'Candidate missing title string' };
        if (!c.noveltyKey || typeof c.noveltyKey !== 'string') return { valid: false, error: 'Candidate missing noveltyKey' };
        if (!c.profile || typeof c.profile !== 'string') return { valid: false, error: 'Candidate missing profile' };
        if (!c.evidence || !Array.isArray(c.evidence) || c.evidence.length === 0) {
          return { valid: false, error: 'Candidate requires non-empty evidence array' };
        }
      }
      return { valid: true };

    case 'evidence_gap_plan':
      if (!Array.isArray(data.missingFacts)) return { valid: false, error: 'missingFacts must be an array' };
      if (!Array.isArray(data.staleFacts)) return { valid: false, error: 'staleFacts must be an array' };
      if (typeof data.needsFreshSearch !== 'boolean') return { valid: false, error: 'needsFreshSearch must be a boolean' };
      return { valid: true };

    case 'adversarial_validation':
      if (!data.gateEvidence || typeof data.gateEvidence !== 'object') {
        return { valid: false, error: 'gateEvidence object is required' };
      }
      if (!Array.isArray(data.adversarialRisks)) {
        return { valid: false, error: 'adversarialRisks array is required' };
      }
      return { valid: true };

    case 'execution_plan':
      if (!Array.isArray(data.steps)) return { valid: false, error: 'steps must be an array' };
      if (!Array.isArray(data.requiredAdapters)) return { valid: false, error: 'requiredAdapters must be an array' };
      if (typeof data.actionSummary !== 'string') return { valid: false, error: 'actionSummary must be a string' };
      return { valid: true };

    case 'learning_inference':
      if (!Array.isArray(data.insights)) return { valid: false, error: 'insights array is required' };
      for (const ins of data.insights) {
        if (!ins.topic || typeof ins.topic !== 'string') return { valid: false, error: 'Insight missing topic string' };
        if (!ins.lesson || typeof ins.lesson !== 'string') return { valid: false, error: 'Insight missing lesson string' };
        if (typeof ins.confidence !== 'number') return { valid: false, error: 'Insight missing numeric confidence' };
      }
      return { valid: true };

    default:
      return { valid: false, error: `Unknown schemaName: ${schemaName}` };
  }
}
