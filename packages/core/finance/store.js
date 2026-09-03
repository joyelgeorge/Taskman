import { databaseEnabled, query } from '@taskman/db';
import { MemoryTable } from '../memory-table.js';

const mem = { expenses: new MemoryTable() };

const CATEGORIES = Object.freeze(['infra', 'marketing', 'tooling', 'other']);

const normalize = (row = {}) => ({
  id: row.id,
  category: row.category,
  amountCents: Number(row.amountCents ?? row.amount_cents),
  description: row.description ?? null,
  campaignKey: row.campaignKey ?? row.campaign_key ?? null,
  incurredAt: row.incurredAt ?? row.incurred_at ?? null,
  createdAt: row.createdAt ?? row.created_at ?? null
});

export async function recordExpense({ category, amountCents, description = null, campaignKey = null, incurredAt = null }) {
  if (!CATEGORIES.includes(category)) throw new Error(`category must be one of ${CATEGORIES.join(', ')}`);
  const cents = Math.round(Number(amountCents) || 0);
  if (cents <= 0) throw new Error('amountCents must be a positive amount');

  const row = normalize({
    id: crypto.randomUUID(), category, amount_cents: cents, description, campaign_key: campaignKey,
    incurred_at: incurredAt || new Date().toISOString(), created_at: new Date().toISOString()
  });

  if (!databaseEnabled) {
    mem.expenses.insert(row);
    return row;
  }

  const result = await query(`
    INSERT INTO expenses(id, category, amount_cents, description, campaign_key, incurred_at)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *
  `, [row.id, category, cents, description, campaignKey, row.incurredAt]);
  return normalize(result.rows[0]);
}

export async function listExpenses({ since = null, category = null, campaignKey = null } = {}) {
  if (!databaseEnabled) {
    return mem.expenses.filter(e =>
      (!since || e.incurredAt >= since) &&
      (!category || e.category === category) &&
      (!campaignKey || e.campaignKey === campaignKey)
    ).map(normalize);
  }
  const conditions = [];
  const params = [];
  if (since) { params.push(since); conditions.push(`incurred_at >= $${params.length}`); }
  if (category) { params.push(category); conditions.push(`category = $${params.length}`); }
  if (campaignKey) { params.push(campaignKey); conditions.push(`campaign_key = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(`SELECT * FROM expenses ${where} ORDER BY incurred_at DESC`, params);
  return result.rows.map(normalize);
}

export function resetFinanceMemory() { mem.expenses.clear(); }
export { CATEGORIES as EXPENSE_CATEGORIES };
