-- Operational costs that don't belong to any one rail attempt: hosting, a paid
-- API, a tool subscription, or (once one exists) a marketing campaign's drone
-- and transform calls. rail_attempts already tracks the cost of trying to
-- execute a candidate; this table is everything else a real business spends,
-- so the finance report (packages/core/finance/report.js) can compute a real
-- net position instead of just the rail-attempt slice of it.

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  description TEXT,
  campaign_key TEXT,
  incurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT expenses_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT expenses_category_known CHECK (category IN ('infra', 'marketing', 'tooling', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_expenses_incurred ON expenses(incurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_campaign ON expenses(campaign_key) WHERE campaign_key IS NOT NULL;
