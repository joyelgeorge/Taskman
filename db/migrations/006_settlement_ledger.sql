-- Settlement-verified money ledger.
--
-- Rationale: money_events (001) is written only from a knowledge event that the
-- execution path never emits, and execution outcomes carry attributableValue in a
-- JSONB queue payload. Nothing in the system can answer "how much money actually
-- landed, and who can confirm it". These tables are that answer.
--
-- Invariant: a settlement row requires an external reference from a system that can
-- be re-queried. Self-reported revenue is not representable here by construction.

CREATE TABLE IF NOT EXISTS rail_state (
  rail TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'read_only',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  disabled_reason TEXT,
  probation_budget_cents BIGINT NOT NULL DEFAULT 5000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rail_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rail TEXT NOT NULL,
  candidate_key TEXT,
  stage TEXT NOT NULL DEFAULT 'EXECUTE',
  status TEXT NOT NULL DEFAULT 'STARTED',
  cost_cents BIGINT NOT NULL DEFAULT 0,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rail_attempts_rail_time ON rail_attempts(rail, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_rail_attempts_rail_status ON rail_attempts(rail, status);

CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rail TEXT NOT NULL,
  attempt_id UUID REFERENCES rail_attempts(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  external_ref TEXT NOT NULL,
  gross_cents BIGINT NOT NULL,
  fee_cents BIGINT NOT NULL DEFAULT 0,
  net_cents BIGINT GENERATED ALWAYS AS (gross_cents - fee_cents) STORED,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'PENDING',
  verified_at TIMESTAMPTZ,
  verification JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT settlements_gross_positive CHECK (gross_cents > 0),
  CONSTRAINT settlements_source_verifiable CHECK (source IN ('stripe','bank','manual_receipt'))
);

-- The same processor reference can never be counted twice.
CREATE UNIQUE INDEX IF NOT EXISTS settlements_source_ref_uidx ON settlements(source, external_ref);
CREATE INDEX IF NOT EXISTS idx_settlements_rail_status ON settlements(rail, status);

CREATE OR REPLACE VIEW rail_economics AS
SELECT
  r.rail,
  COALESCE(a.attempts, 0)                                   AS attempts,
  COALESCE(a.spend_cents, 0)                                AS spend_cents,
  COALESCE(s.cleared_count, 0)                              AS cleared_count,
  COALESCE(s.cleared_cents, 0)                              AS cleared_cents,
  COALESCE(s.pending_cents, 0)                              AS pending_cents,
  COALESCE(s.cleared_cents, 0) - COALESCE(a.spend_cents, 0) AS net_cents
FROM (
  SELECT rail FROM rail_attempts
  UNION
  SELECT rail FROM settlements
  UNION
  SELECT rail FROM rail_state
) r
LEFT JOIN (
  SELECT rail, COUNT(*) AS attempts, SUM(cost_cents) AS spend_cents
  FROM rail_attempts GROUP BY rail
) a ON a.rail = r.rail
LEFT JOIN (
  SELECT rail,
         COUNT(*) FILTER (WHERE status = 'CLEARED')                         AS cleared_count,
         COALESCE(SUM(net_cents) FILTER (WHERE status = 'CLEARED'), 0)      AS cleared_cents,
         COALESCE(SUM(net_cents) FILTER (WHERE status = 'PENDING'), 0)      AS pending_cents
  FROM settlements GROUP BY rail
) s ON s.rail = r.rail;
