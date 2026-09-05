import crypto from 'node:crypto';
import { databaseEnabled, query } from '@taskman/db';
import { MemoryTable, nowIso } from '../memory-table.js';

export const CAMPAIGN_STATUS = Object.freeze({
  SCOPING: 'SCOPING',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  KILLED: 'KILLED'
});

export const LEAD_SOURCE = Object.freeze({
  DRONE: 'drone',
  MANUAL: 'manual'
});

export const LEAD_STATUS = Object.freeze({
  NEW: 'NEW',
  QUALIFIED: 'QUALIFIED',
  REJECTED: 'REJECTED',
  CONVERTED: 'CONVERTED'
});

const mem = {
  campaigns: new MemoryTable({ unique: ['campaignKey'] }),
  leads: new MemoryTable({ unique: ['id'] })
};

const normalizeCampaign = (row = {}) => ({
  campaignKey: row.campaignKey ?? row.campaign_key,
  name: row.name,
  lane: row.lane,
  valueProposition: row.valueProposition ?? row.value_proposition,
  evidence: row.evidence || {},
  status: row.status || CAMPAIGN_STATUS.SCOPING,
  probationBudgetCents: Number(row.probationBudgetCents ?? row.probation_budget_cents ?? 5000),
  probationEpoch: Number(row.probationEpoch ?? row.probation_epoch ?? 0),
  createdAt: row.createdAt ?? row.created_at ?? null,
  updatedAt: row.updatedAt ?? row.updated_at ?? null
});

const normalizeLead = (row = {}) => ({
  id: row.id,
  campaignKey: row.campaignKey ?? row.campaign_key,
  source: row.source || LEAD_SOURCE.MANUAL,
  rawRecord: row.rawRecord ?? row.raw_record ?? {},
  contactHint: row.contactHint ?? row.contact_hint ?? null,
  status: row.status || LEAD_STATUS.NEW,
  createdAt: row.createdAt ?? row.created_at ?? null,
  updatedAt: row.updatedAt ?? row.updated_at ?? null
});

/**
 * Register or update a campaign.
 */
export async function upsertCampaign({
  campaignKey,
  name,
  lane,
  valueProposition,
  evidence = {},
  status = CAMPAIGN_STATUS.SCOPING,
  probationBudgetCents = 5000,
  probationEpoch = 0
}) {
  if (!campaignKey || !name || !lane || !valueProposition) {
    throw new Error('campaignKey, name, lane, and valueProposition are required');
  }

  if (!Object.values(CAMPAIGN_STATUS).includes(status)) {
    throw new Error(`Invalid campaign status: ${status}`);
  }

  const now = nowIso();
  const row = normalizeCampaign({
    campaignKey,
    name,
    lane,
    valueProposition,
    evidence,
    status,
    probationBudgetCents,
    probationEpoch,
    createdAt: now,
    updatedAt: now
  });

  if (!databaseEnabled) {
    mem.campaigns.upsert(row, {
      name,
      lane,
      valueProposition,
      evidence,
      status,
      probationBudgetCents,
      probationEpoch,
      updatedAt: now
    });
    return mem.campaigns.find(c => c.campaignKey === campaignKey);
  }

  const result = await query(`
    INSERT INTO campaigns(
      campaign_key, name, lane, value_proposition, evidence,
      status, probation_budget_cents, probation_epoch, created_at, updated_at
    )
    VALUES($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $9)
    ON CONFLICT (campaign_key) DO UPDATE SET
      name = EXCLUDED.name,
      lane = EXCLUDED.lane,
      value_proposition = EXCLUDED.value_proposition,
      evidence = EXCLUDED.evidence,
      status = EXCLUDED.status,
      probation_budget_cents = EXCLUDED.probation_budget_cents,
      probation_epoch = EXCLUDED.probation_epoch,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `, [
    campaignKey, name, lane, valueProposition, JSON.stringify(evidence),
    status, probationBudgetCents, probationEpoch, now
  ]);

  return normalizeCampaign(result.rows[0]);
}

export async function getCampaign(campaignKey) {
  if (!databaseEnabled) {
    const found = mem.campaigns.find(c => c.campaignKey === campaignKey);
    return found ? normalizeCampaign(found) : null;
  }
  const result = await query('SELECT * FROM campaigns WHERE campaign_key = $1', [campaignKey]);
  return result.rows[0] ? normalizeCampaign(result.rows[0]) : null;
}

export async function listCampaigns({ status = null } = {}) {
  if (!databaseEnabled) {
    return mem.campaigns.filter(c => !status || c.status === status).map(normalizeCampaign);
  }
  const where = status ? 'WHERE status = $1' : '';
  const params = status ? [status] : [];
  const result = await query(`SELECT * FROM campaigns ${where} ORDER BY created_at DESC`, params);
  return result.rows.map(normalizeCampaign);
}

/**
 * Inserts a lead candidate buyer record.
 */
export async function createLead({
  campaignKey,
  source = LEAD_SOURCE.MANUAL,
  rawRecord = {},
  contactHint = null,
  status = LEAD_STATUS.NEW
}) {
  if (!campaignKey) {
    throw new Error('campaignKey is required for lead');
  }
  if (!Object.values(LEAD_SOURCE).includes(source)) {
    throw new Error(`Invalid lead source: ${source}`);
  }
  if (!Object.values(LEAD_STATUS).includes(status)) {
    throw new Error(`Invalid lead status: ${status}`);
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  const row = normalizeLead({
    id,
    campaignKey,
    source,
    rawRecord,
    contactHint,
    status,
    createdAt: now,
    updatedAt: now
  });

  if (!databaseEnabled) {
    mem.leads.insert(row);
    return row;
  }

  const result = await query(`
    INSERT INTO leads(id, campaign_key, source, raw_record, contact_hint, status, created_at, updated_at)
    VALUES($1, $2, $3, $4::jsonb, $5, $6, $7, $7)
    RETURNING *
  `, [
    id, campaignKey, source, JSON.stringify(rawRecord), contactHint, status, now
  ]);

  return normalizeLead(result.rows[0]);
}

export async function getLead(id) {
  if (!databaseEnabled) {
    const found = mem.leads.find(l => l.id === id);
    return found ? normalizeLead(found) : null;
  }
  const result = await query('SELECT * FROM leads WHERE id = $1', [id]);
  return result.rows[0] ? normalizeLead(result.rows[0]) : null;
}

export async function updateLeadStatus(id, newStatus) {
  if (!Object.values(LEAD_STATUS).includes(newStatus)) {
    throw new Error(`Invalid lead status: ${newStatus}`);
  }
  const now = nowIso();

  if (!databaseEnabled) {
    const found = mem.leads.find(l => l.id === id);
    if (found) {
      found.status = newStatus;
      found.updatedAt = now;
      return normalizeLead(found);
    }
    return null;
  }

  const result = await query(
    `UPDATE leads SET status = $2, updated_at = $3 WHERE id = $1 RETURNING *`,
    [id, newStatus, now]
  );
  return result.rows[0] ? normalizeLead(result.rows[0]) : null;
}

export async function listLeads({ campaignKey = null, status = null } = {}) {
  if (!databaseEnabled) {
    return mem.leads.filter(l => {
      if (campaignKey && l.campaignKey !== campaignKey) return false;
      if (status && l.status !== status) return false;
      return true;
    }).map(normalizeLead);
  }

  const conditions = [];
  const params = [];
  if (campaignKey) {
    params.push(campaignKey);
    conditions.push(`campaign_key = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(`SELECT * FROM leads ${where} ORDER BY created_at DESC`, params);
  return result.rows.map(normalizeLead);
}

export function resetMarketingMemory() {
  mem.campaigns.clear();
  mem.leads.clear();
}
