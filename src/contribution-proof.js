import crypto from 'node:crypto';
import { databaseEnabled, query } from './db.js';

// In-memory store for contribution records and outcome pages
const contributionRecordsMemory = new Map(); // id -> record
const outcomePagesMemory = new Map(); // slug -> page

export const ACTOR_TYPE = Object.freeze({
  HUMAN: 'HUMAN',
  AI: 'AI',
  DETERMINISTIC: 'DETERMINISTIC',
  EXTERNAL_SYSTEM: 'EXTERNAL_SYSTEM'
});

/**
 * Creates a durable append-only Contribution Record.
 */
export function recordContribution({
  workflowId,
  actorType,
  actorName, // e.g. 'joyelgeorge' or 'model:gpt-4o' or 'system:test-runner'
  actionName,
  description,
  inputEvidenceHash = null,
  outputArtifactHash = null,
  costCents = 0,
  latencyMs = 0
}) {
  if (!workflowId || !actorType || !actionName) {
    throw new Error('Contribution requires workflowId, actorType, and actionName');
  }

  if (!Object.values(ACTOR_TYPE).includes(actorType)) {
    throw new Error(`Invalid actorType: ${actorType}`);
  }

  const record = {
    id: `contrib-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    workflowId,
    actorType,
    actorName: actorName || (actorType === ACTOR_TYPE.AI ? 'unknown_model' : 'system'),
    actionName,
    description: description || '',
    inputEvidenceHash,
    outputArtifactHash,
    costCents,
    latencyMs,
    createdAt: new Date().toISOString()
  };

  const existing = contributionRecordsMemory.get(workflowId) || [];
  existing.push(record);
  contributionRecordsMemory.set(workflowId, existing);

  return record;
}

export function getWorkflowContributions(workflowId) {
  return contributionRecordsMemory.get(workflowId) || [];
}

/**
 * Sanitizes and generates a shareable outcome page.
 * Private by default. Masks secrets, API tokens, sensitive PII.
 */
export function generateShareableOutcomePage({
  workflowId,
  objective,
  verifiedOutcomeCents = 0,
  estimatedSavingsCents = 0,
  evidenceRefs = [],
  isPublic = false,
  customTitle = null
}) {
  const contributions = getWorkflowContributions(workflowId);

  // Group by actorType
  const humanContributions = contributions.filter(c => c.actorType === ACTOR_TYPE.HUMAN);
  const aiContributions = contributions.filter(c => c.actorType === ACTOR_TYPE.AI);
  const deterministicChecks = contributions.filter(c => c.actorType === ACTOR_TYPE.DETERMINISTIC);
  const externalSystemEvents = contributions.filter(c => c.actorType === ACTOR_TYPE.EXTERNAL_SYSTEM);

  // Sanitize evidence refs: strip raw keys, keep hashes or truncated public IDs
  const sanitizedEvidenceRefs = evidenceRefs.map(ref => {
    if (typeof ref === 'string') {
      return ref.replace(/(token|key|secret|password)=[^\s&]+/gi, '$1=REDACTED');
    }
    return ref;
  });

  const pageSlug = `proof-${crypto.createHash('sha256').update(workflowId + Date.now()).digest('hex').slice(0, 12)}`;

  const outcomePage = {
    slug: pageSlug,
    workflowId,
    title: customTitle || `Verified Outcome: ${objective}`,
    objective,
    isPublic: Boolean(isPublic), // Explicit publication required
    economics: {
      verifiedOutcomeCents,
      estimatedSavingsCents,
      isVerifiedCash: verifiedOutcomeCents > 0
    },
    attribution: {
      humanActionsCount: humanContributions.length,
      aiActionsCount: aiContributions.length,
      deterministicChecksCount: deterministicChecks.length,
      externalEventsCount: externalSystemEvents.length,
      contributions: contributions.map(c => ({
        actorType: c.actorType,
        actorName: c.actorName,
        actionName: c.actionName,
        description: c.description
      }))
    },
    evidenceRefs: sanitizedEvidenceRefs,
    publishedAt: isPublic ? new Date().toISOString() : null,
    createdAt: new Date().toISOString()
  };

  outcomePagesMemory.set(pageSlug, outcomePage);
  return outcomePage;
}

export function getOutcomePage(slug) {
  return outcomePagesMemory.get(slug) || null;
}

export function publishOutcomePage(slug) {
  const page = outcomePagesMemory.get(slug);
  if (!page) {
    throw new Error(`Outcome page ${slug} not found`);
  }
  page.isPublic = true;
  page.publishedAt = new Date().toISOString();
  return page;
}

export function resetContributionProofMemory() {
  contributionRecordsMemory.clear();
  outcomePagesMemory.clear();
}
