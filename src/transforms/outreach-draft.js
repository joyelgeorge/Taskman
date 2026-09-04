import crypto from 'node:crypto';
import { databaseEnabled, query } from '../db.js';

// In-memory table for outreach drafts when database is disabled
const memoryOutreachDrafts = new Map();

export const OUTREACH_DRAFT_STATUS = Object.freeze({
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  DISCARDED: 'DISCARDED',
  SENT: 'SENT',
  REPLIED: 'REPLIED',
  DECLINED: 'DECLINED',
  CONVERTED: 'CONVERTED'
});

/**
 * Deterministic post-condition validator for outreach drafts.
 * Rules:
 * 1. No dollar figure in the draft that doesn't appear verbatim in lead or campaign evidence.
 * 2. No language implying prior relationship, authority, or affiliation that campaign doesn't declare.
 * 3. Sourcing is disclosed in plain language (e.g. mentions public records, directory, or data source).
 * 4. An explicit opt-out or decline path is present.
 */
export function validateOutreachDraftPostCondition({ draftText, lead, campaign }) {
  if (!draftText || typeof draftText !== 'string' || draftText.trim().length < 20) {
    return { ok: false, reason: 'Draft text is missing or too short' };
  }

  // Check 1: Dollar figures verification
  const dollarMatches = draftText.match(/\$[0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2})?/g) || [];
  if (dollarMatches.length > 0) {
    const leadString = JSON.stringify(lead?.rawRecord || {}) + ' ' + (lead?.contactHint || '');
    const campaignString = JSON.stringify(campaign?.evidence || {}) + ' ' + (campaign?.valueProposition || '');
    const combinedSource = leadString + ' ' + campaignString;

    for (const dollar of dollarMatches) {
      if (!combinedSource.includes(dollar)) {
        return {
          ok: false,
          reason: `Fabricated dollar figure "${dollar}" in draft not found verbatim in lead or campaign evidence`
        };
      }
    }
  }

  // Check 2: False authority or existing relationship claims
  const forbiddenPhrases = [
    'per our previous call',
    'as we discussed earlier',
    'official government representative',
    'from the state department',
    'our contract requires',
    'your account manager'
  ];
  const lowerDraft = draftText.toLowerCase();
  for (const phrase of forbiddenPhrases) {
    if (lowerDraft.includes(phrase)) {
      return {
        ok: false,
        reason: `Draft contains forbidden relationship or authority claim: "${phrase}"`
      };
    }
  }

  // Check 3: Sourcing disclosure in plain language
  const sourcingKeywords = ['public record', 'public directory', 'public registry', 'state listing', 'filing', 'found your listing', 'sourced from'];
  const hasSourcingDisclosure = sourcingKeywords.some(kw => lowerDraft.includes(kw));
  if (!hasSourcingDisclosure) {
    return {
      ok: false,
      reason: 'Draft fails to disclose source in plain language (e.g., public records/directory)'
    };
  }

  // Check 4: Opt-out or decline path present
  const optOutKeywords = ['opt out', 'unsubscribe', 'let me know if not interested', 'no need to reply', 'decline', 'prefer not to hear'];
  const hasOptOut = optOutKeywords.some(kw => lowerDraft.includes(kw));
  if (!hasOptOut) {
    return {
      ok: false,
      reason: 'Draft fails to include an opt-out or decline path'
    };
  }

  return { ok: true };
}

/**
 * Runs outreach-draft transform. Never sends messages.
 * If model call or post-condition fails, output is discarded, never stored as reviewable.
 */
export async function runOutreachDraftTransform({
  lead,
  campaign,
  modelDraftGenerator // async ({ lead, campaign }) => ({ draftText, subject })
}) {
  if (!lead || !campaign) {
    return { ok: false, error: 'lead and campaign are required' };
  }

  let generated;
  try {
    generated = await modelDraftGenerator({ lead, campaign });
  } catch (err) {
    return { ok: false, error: `Model draft generation failed: ${err.message}` };
  }

  const { draftText, subject } = generated || {};
  const verdict = validateOutreachDraftPostCondition({ draftText, lead, campaign });

  if (!verdict.ok) {
    return {
      ok: false,
      error: `Post-condition failed: ${verdict.reason}`,
      discarded: true
    };
  }

  const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const draftRecord = {
    id,
    leadId: lead.id,
    campaignKey: campaign.campaignKey,
    subject: subject || `Regarding ${campaign.name}`,
    draftText,
    status: OUTREACH_DRAFT_STATUS.READY_FOR_REVIEW,
    createdAt: new Date().toISOString()
  };

  if (!databaseEnabled) {
    memoryOutreachDrafts.set(id, draftRecord);
    return { ok: true, draft: draftRecord };
  }

  // Insert into DB if enabled
  try {
    const res = await query(`
      INSERT INTO outreach_drafts (id, lead_id, campaign_key, subject, draft_text, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      RETURNING *
    `, [draftRecord.id, draftRecord.leadId, draftRecord.campaignKey, draftRecord.subject, draftRecord.draftText, draftRecord.status]);
    return { ok: true, draft: res.rows[0] };
  } catch (err) {
    // If DB table not migrated yet, fallback to memory
    memoryOutreachDrafts.set(id, draftRecord);
    return { ok: true, draft: draftRecord };
  }
}

export function getOutreachDraft(id) {
  return memoryOutreachDrafts.get(id) || null;
}

export function listOutreachDrafts({ campaignKey = null, status = null } = {}) {
  return Array.from(memoryOutreachDrafts.values()).filter(d => {
    if (campaignKey && d.campaignKey !== campaignKey) return false;
    if (status && d.status !== status) return false;
    return true;
  });
}

export function resetOutreachDraftsMemory() {
  memoryOutreachDrafts.clear();
}
