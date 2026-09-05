import { databaseEnabled, query, truncateForTesting } from '@taskman/db';
import { MemoryTable } from '../memory-table.js';

const mem = {
  expenses: new MemoryTable(),
  reportHistory: new MemoryTable({ unique: ['snapshotDate'] })
};

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

const normalizeHistory = (row = {}) => ({
  id: row.id,
  snapshotDate: typeof row.snapshot_date === 'string'
    ? row.snapshot_date.slice(0, 10)
    : (row.snapshotDate ?? (row.snapshot_date instanceof Date ? row.snapshot_date.toISOString().slice(0, 10) : String(row.snapshot_date || ''))),
  grossClearedCents: Number(row.grossClearedCents ?? row.gross_cleared_cents ?? 0),
  railSpendCents: Number(row.railSpendCents ?? row.rail_spend_cents ?? 0),
  expenseCents: Number(row.expenseCents ?? row.expense_cents ?? 0),
  totalSpendCents: Number(row.totalSpendCents ?? row.total_spend_cents ?? 0),
  netCents: Number(row.netCents ?? row.net_cents ?? 0),
  marginPct: (row.marginPct ?? row.margin_pct) != null ? Number(row.marginPct ?? row.margin_pct) : null,
  burnRateCentsPerDay: Number(row.burnRateCentsPerDay ?? row.burn_rate_cents_per_day ?? 0),
  runwayDays: (row.runwayDays ?? row.runway_days) != null ? Number(row.runwayDays ?? row.runway_days) : null,
  reportPayload: typeof row.report_payload === 'string' ? JSON.parse(row.report_payload) : (row.reportPayload ?? row.report_payload ?? {}),
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

export async function recordFinanceReportSnapshot({ date = null, report = {} } = {}) {
  const snapshotDate = typeof date === 'string'
    ? date.slice(0, 10)
    : (date instanceof Date ? date.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));

  const grossClearedCents = Math.round(Number(report.lifetime?.grossClearedCents || 0));
  const railSpendCents = Math.round(Number(report.lifetime?.railSpendCents || 0));
  const expenseCents = Math.round(Number(report.lifetime?.expenseCents || 0));
  const totalSpendCents = Math.round(Number(report.lifetime?.totalSpendCents || 0));
  const netCents = Math.round(Number(report.lifetime?.netCents || 0));
  const marginPct = report.lifetime?.marginPct != null ? Number(report.lifetime.marginPct) : null;
  const burnRateCentsPerDay = Math.round(Number(report.trailing?.burnRateCentsPerDay || 0));
  const runwayDays = report.runway?.runwayDays != null ? Number(report.runway.runwayDays) : null;

  const row = normalizeHistory({
    id: crypto.randomUUID(),
    snapshotDate,
    grossClearedCents,
    railSpendCents,
    expenseCents,
    totalSpendCents,
    netCents,
    marginPct,
    burnRateCentsPerDay,
    runwayDays,
    reportPayload: report,
    createdAt: new Date().toISOString()
  });

  if (!databaseEnabled) {
    const { row: saved } = mem.reportHistory.upsert(row);
    return normalizeHistory(saved);
  }

  const result = await query(`
    INSERT INTO finance_report_history(
      id, snapshot_date, gross_cleared_cents, rail_spend_cents, expense_cents,
      total_spend_cents, net_cents, margin_pct, burn_rate_cents_per_day,
      runway_days, report_payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (snapshot_date) DO UPDATE SET
      gross_cleared_cents = EXCLUDED.gross_cleared_cents,
      rail_spend_cents = EXCLUDED.rail_spend_cents,
      expense_cents = EXCLUDED.expense_cents,
      total_spend_cents = EXCLUDED.total_spend_cents,
      net_cents = EXCLUDED.net_cents,
      margin_pct = EXCLUDED.margin_pct,
      burn_rate_cents_per_day = EXCLUDED.burn_rate_cents_per_day,
      runway_days = EXCLUDED.runway_days,
      report_payload = EXCLUDED.report_payload
    RETURNING *
  `, [
    row.id, snapshotDate, grossClearedCents, railSpendCents, expenseCents,
    totalSpendCents, netCents, marginPct, burnRateCentsPerDay,
    runwayDays, JSON.stringify(report)
  ]);
  return normalizeHistory(result.rows[0]);
}

export async function listFinanceReportHistory({ since = null, limit = 30 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 30, 1), 365);
  if (!databaseEnabled) {
    return mem.reportHistory
      .filter(h => !since || h.snapshotDate >= since.slice(0, 10))
      .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))
      .slice(0, cap)
      .map(normalizeHistory);
  }
  const conditions = [];
  const params = [];
  if (since) {
    params.push(since.slice(0, 10));
    conditions.push(`snapshot_date >= $${params.length}`);
  }
  params.push(cap);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query(`
    SELECT * FROM finance_report_history ${where}
    ORDER BY snapshot_date DESC
    LIMIT $${params.length}
  `, params);
  return result.rows.map(normalizeHistory);
}

export async function resetFinanceMemory() {
  mem.expenses.clear();
  mem.reportHistory.clear();
  await truncateForTesting(['expenses', 'finance_report_history']);
}
export { CATEGORIES as EXPENSE_CATEGORIES };
