-- Snapshots of the finance report (packages/core/finance/report.js) taken
-- daily so the dashboard can plot historical trend lines (net position, burn rate,
-- runway, margins) rather than only displaying the current moment.
-- See docs/MARKETING_FINANCE_WING.md §3.2 and Issue #134.

CREATE TABLE IF NOT EXISTS finance_report_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE UNIQUE NOT NULL,
  gross_cleared_cents BIGINT NOT NULL,
  rail_spend_cents BIGINT NOT NULL,
  expense_cents BIGINT NOT NULL,
  total_spend_cents BIGINT NOT NULL,
  net_cents BIGINT NOT NULL,
  margin_pct NUMERIC(6,2),
  burn_rate_cents_per_day BIGINT NOT NULL,
  runway_days INTEGER,
  report_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_report_history_date ON finance_report_history(snapshot_date DESC);
