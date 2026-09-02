import { sharedReasoningEngine } from '../reasoning-engine.js';
import { EIGHT_MONEY_FLOW_GATES } from '../gates.js';

/**
 * Fills gate evidence for a candidate that has none. This is a transform, not
 * discovery: it never originates a candidate, only attaches evidence to one that
 * already survived deterministic qualification.
 *
 * Schema validation (reasoning-schemas.js) only checks that gateEvidence is an
 * object and adversarialRisks is an array — it cannot tell a real citation from
 * the model restating the gate's own name back at itself, which is the failure
 * mode that actually matters here. The post-condition below checks that.
 */
function evidenceLooksReal(evidenceRef, gateName) {
  if (typeof evidenceRef !== 'string') return false;
  const trimmed = evidenceRef.trim();
  if (trimmed.length < 8) return false;
  // A model under instruction to "cite evidence" will sometimes just echo the
  // gate name or a one-word placeholder back. Neither is a citation.
  const gateWords = gateName.replace(/_/g, ' ').toLowerCase();
  if (trimmed.toLowerCase() === gateWords) return false;
  if (/^(n\/a|none|unknown|tbd|pending)$/i.test(trimmed)) return false;
  return true;
}

export function validateGateEvidencePostCondition(data) {
  const gateEvidence = data?.gateEvidence;
  if (!gateEvidence || typeof gateEvidence !== 'object') {
    return { ok: false, reason: 'gateEvidence is missing' };
  }
  for (const gate of EIGHT_MONEY_FLOW_GATES) {
    const entry = gateEvidence[gate];
    if (!entry) continue; // absent gates fall through to NEEDS_EVIDENCE downstream, which is correct
    if (!['pass', 'fail', 'uncertain'].includes(entry.verdict)) {
      return { ok: false, reason: `gate "${gate}" has an unrecognized verdict: ${entry.verdict}` };
    }
    if (entry.verdict !== 'uncertain' && !evidenceLooksReal(entry.evidenceRef, gate)) {
      return { ok: false, reason: `gate "${gate}" verdict "${entry.verdict}" is not backed by a real evidence reference` };
    }
  }
  return { ok: true };
}

/**
 * Attaches adversarially-checked gate evidence to a candidate. Returns the
 * candidate unchanged if the model call fails or the post-condition rejects the
 * output — a transform that cannot produce a trustworthy result must leave the
 * candidate exactly as evidence-driven validation already found it, never worse.
 */
export async function runAdversarialValidation({ candidate, freshEvidence = [], mockProvider = null }) {
  const result = await sharedReasoningEngine.validateAdversarial({ candidate, freshEvidence, mockProvider });
  if (!result.ok) return { ok: false, transform: 'adversarial-validation', error: result.error };

  const verdict = validateGateEvidencePostCondition(result.data);
  if (!verdict.ok) {
    return { ok: false, transform: 'adversarial-validation', error: `post-condition failed: ${verdict.reason}`, rejectedData: result.data };
  }

  return { ok: true, transform: 'adversarial-validation', data: result.data };
}
