import { databaseEnabled, query, truncateForTesting } from '@taskman/db';
import { MemoryTable } from '../memory-table.js';

const mem = { products: new MemoryTable({ unique: ['productKey'] }) };

const normalize = (row = {}) => ({
  productKey: row.productKey ?? row.product_key,
  title: row.title,
  buyer: row.buyer,
  decision: row.decision,
  seriesKeys: row.seriesKeys ?? row.series_keys ?? [],
  upstreamLicences: row.upstreamLicences ?? row.upstream_licences ?? [],
  resalePermitted: row.resalePermitted ?? row.resale_permitted ?? false,
  reconstructible: row.reconstructible,
  reconstructibleNote: row.reconstructibleNote ?? row.reconstructible_note ?? null,
  firstObservedAt: row.firstObservedAt ?? row.first_observed_at ?? null,
  lastObservedAt: row.lastObservedAt ?? row.last_observed_at ?? null,
  observationDays: row.observationDays ?? row.observation_days ?? 0,
  rowCount: Number(row.rowCount ?? row.row_count ?? 0),
  status: row.status || 'ACCRUING'
});

/**
 * Declares a dataset that could be sold.
 *
 * `buyer` and `decision` are mandatory because a dataset with no named buyer and
 * no decision it changes has no price, however many rows it has — that is the
 * whole difference between an asset and a hosting bill.
 *
 * `reconstructible` is the moat test, and it is required rather than defaulted
 * so it must actually be checked. If the publisher archives the same series,
 * a buyer can backfill it for free and elapsed time buys nothing. Our own ECB
 * source fails this test: the ECB publishes eurofxref-hist.xml, the complete
 * historical series, so keeping a daily copy of it accumulates no asset at all.
 */
export async function registerDataProduct({
  productKey, title, buyer, decision, seriesKeys = [],
  upstreamLicences = [], resalePermitted = false,
  reconstructible, reconstructibleNote = null
}) {
  if (!productKey || !title) throw new Error('productKey and title are required');
  if (!buyer) throw new Error(`${productKey}: buyer is required — name who pays, or this is not a product`);
  if (!decision) throw new Error(`${productKey}: decision is required — a dataset that changes no decision has no price`);
  if (typeof reconstructible !== 'boolean') {
    throw new Error(`${productKey}: reconstructible must be checked explicitly — if the publisher archives `
      + 'the same series, elapsed time buys no moat and this is not an asset');
  }
  if (!Array.isArray(seriesKeys) || seriesKeys.length === 0) {
    throw new Error(`${productKey}: at least one series key is required`);
  }

  const row = {
    productKey, title, buyer, decision, seriesKeys, upstreamLicences,
    resalePermitted, reconstructible, reconstructibleNote,
    firstObservedAt: null, lastObservedAt: null, observationDays: 0, rowCount: 0, status: 'ACCRUING'
  };
  if (!databaseEnabled) {
    const existing = mem.products.find(p => p.productKey === productKey);
    if (existing) return normalize(existing);
    mem.products.upsert(row, row);
    return normalize(row);
  }
  const result = await query(`
    INSERT INTO data_products(product_key, title, buyer, decision, series_keys,
      upstream_licences, resale_permitted, reconstructible, reconstructible_note)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
    ON CONFLICT (product_key) DO UPDATE SET
      title=EXCLUDED.title, buyer=EXCLUDED.buyer, decision=EXCLUDED.decision,
      series_keys=EXCLUDED.series_keys, reconstructible=EXCLUDED.reconstructible,
      updated_at=now()
    RETURNING *
  `, [productKey, title, buyer, decision, seriesKeys,
      JSON.stringify(upstreamLicences), resalePermitted, reconstructible, reconstructibleNote]);
  return normalize(result.rows[0]);
}

/**
 * Recomputes what each product actually holds, from the rollups themselves.
 *
 * observation_days is elapsed calendar coverage, not row count: 400 rows all
 * from one day is not a time series. This is the number that grows into value,
 * and the only honest way to state what the asset is worth so far.
 */
export async function refreshDataProducts({ now = new Date() } = {}) {
  const products = await listDataProducts();
  const refreshed = [];

  for (const product of products) {
    let stats = { rowCount: 0, firstObservedAt: null, lastObservedAt: null, observationDays: 0 };

    if (!databaseEnabled) {
      const { listRollups } = await import('../observations/store.js');
      const rows = [];
      for (const key of product.seriesKeys) rows.push(...await listRollups({ seriesKey: key, limit: 100000 }));
      const dates = [...new Set(rows.map(r => r.bucketDate))].sort();
      stats = {
        rowCount: rows.length,
        firstObservedAt: dates[0] || null,
        lastObservedAt: dates[dates.length - 1] || null,
        observationDays: dates.length
      };
    } else {
      const result = await query(`
        SELECT count(*)::bigint AS row_count,
               min(bucket_date)::text AS first_observed_at,
               max(bucket_date)::text AS last_observed_at,
               count(DISTINCT bucket_date)::int AS observation_days
        FROM observation_rollups WHERE series_key = ANY($1)
      `, [product.seriesKeys]);
      const r = result.rows[0];
      stats = {
        rowCount: Number(r.row_count),
        firstObservedAt: r.first_observed_at,
        lastObservedAt: r.last_observed_at,
        observationDays: r.observation_days
      };
      await query(`
        UPDATE data_products SET row_count=$2, first_observed_at=$3::timestamptz,
          last_observed_at=$4::timestamptz, observation_days=$5, updated_at=now()
        WHERE product_key=$1
      `, [product.productKey, stats.rowCount, stats.firstObservedAt, stats.lastObservedAt, stats.observationDays]);
    }

    refreshed.push({ ...product, ...stats, ...appraise({ ...product, ...stats }, now) });
  }
  return refreshed;
}

/**
 * States plainly whether a product is worth anything yet, and why not.
 *
 * Deliberately conservative and deliberately unpriced. This system's recorded
 * failure mode is believing its own optimistic numbers, so this reports the
 * facts that decide value — is it reconstructible, may we resell it, how many
 * days of coverage exist — and refuses to invent a figure for any of them.
 */
export function appraise(product, now = new Date()) {
  const blockers = [];
  if (product.reconstructible) {
    blockers.push('the publisher archives this series, so a buyer can backfill it free — elapsed time buys no moat');
  }
  if (!product.resalePermitted) {
    blockers.push('upstream licence does not clearly permit resale');
  }
  // A year is where a series starts answering seasonality questions, which is
  // the first question any buyer of history actually asks.
  if ((product.observationDays || 0) < 365) {
    blockers.push(`${product.observationDays || 0} of 365 days of coverage — too short to answer a seasonality question`);
  }
  return {
    sellable: blockers.length === 0,
    blockers,
    // No price. Value depends on a buyer this system has not yet met.
    valuation: null
  };
}

export async function listDataProducts() {
  if (!databaseEnabled) return mem.products.all().map(normalize);
  const result = await query('SELECT * FROM data_products ORDER BY product_key');
  return result.rows.map(normalize);
}

export async function resetDataProductMemory() {
  mem.products.clear();
  await truncateForTesting(['data_products']);
}
