ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT 'local-default';

CREATE TABLE IF NOT EXISTS billing_accounts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billable_metrics (
  metric_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  unit TEXT NOT NULL,
  description TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_id, version)
);

CREATE TABLE IF NOT EXISTS billing_plans (
  plan_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, version),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE IF NOT EXISTS plan_entitlements (
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  metric_id TEXT NOT NULL,
  metric_version INTEGER NOT NULL,
  hard_limit NUMERIC,
  soft_limit NUMERIC,
  PRIMARY KEY (plan_id, plan_version, metric_id, metric_version),
  FOREIGN KEY (plan_id, plan_version) REFERENCES billing_plans(plan_id, version) ON DELETE CASCADE,
  FOREIGN KEY (metric_id, metric_version) REFERENCES billable_metrics(metric_id, version),
  CHECK (hard_limit IS NULL OR hard_limit >= 0),
  CHECK (soft_limit IS NULL OR soft_limit >= 0),
  CHECK (hard_limit IS NULL OR soft_limit IS NULL OR soft_limit <= hard_limit)
);

CREATE TABLE IF NOT EXISTS account_plan_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL REFERENCES billing_accounts(id),
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  FOREIGN KEY (plan_id, plan_version) REFERENCES billing_plans(plan_id, version),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE INDEX IF NOT EXISTS idx_account_plan_effective
  ON account_plan_assignments(account_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS pricing_versions (
  pricing_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pricing_id, version),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE IF NOT EXISTS metric_prices (
  pricing_id TEXT NOT NULL,
  pricing_version INTEGER NOT NULL,
  metric_id TEXT NOT NULL,
  metric_version INTEGER NOT NULL,
  unit_price NUMERIC(24,12) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (pricing_id, pricing_version, metric_id, metric_version),
  FOREIGN KEY (pricing_id, pricing_version) REFERENCES pricing_versions(pricing_id, version) ON DELETE CASCADE,
  FOREIGN KEY (metric_id, metric_version) REFERENCES billable_metrics(metric_id, version)
);

CREATE TABLE IF NOT EXISTS meter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL REFERENCES billing_accounts(id),
  metric_id TEXT NOT NULL,
  metric_version INTEGER NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  source_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  correction_of UUID REFERENCES meter_events(id),
  FOREIGN KEY (metric_id, metric_version) REFERENCES billable_metrics(metric_id, version),
  UNIQUE (account_id, metric_id, metric_version, source_id),
  CHECK ((correction_of IS NULL AND quantity > 0) OR (correction_of IS NOT NULL AND quantity < 0))
);

CREATE INDEX IF NOT EXISTS idx_meter_events_account_metric_time
  ON meter_events(account_id, metric_id, metric_version, occurred_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS billing_export_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  meter_event_id UUID NOT NULL REFERENCES meter_events(id),
  export_key_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'exported', 'reconciled', 'failed')),
  provider_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, meter_event_id),
  UNIQUE (provider, export_key_hash)
);

INSERT INTO billable_metrics(metric_id, version, unit, description)
VALUES
  ('ai_tokens', 1, 'token', 'Provider-reported AI input and output tokens'),
  ('successful_runs', 1, 'run', 'Successfully completed Taskman runs'),
  ('connector_calls', 1, 'call', 'Authorized external connector calls')
ON CONFLICT (metric_id, version) DO NOTHING;

-- A bounded local-development assignment preserves the existing single-user POC.
-- Application code refuses this plan when NODE_ENV=production.
INSERT INTO billing_accounts(id) VALUES ('local-default') ON CONFLICT (id) DO NOTHING;
INSERT INTO billing_plans(plan_id, version, effective_from)
VALUES ('development', 1, '2020-01-01T00:00:00Z')
ON CONFLICT (plan_id, version) DO NOTHING;
INSERT INTO plan_entitlements(plan_id, plan_version, metric_id, metric_version, hard_limit, soft_limit)
VALUES
  ('development', 1, 'ai_tokens', 1, 1000000, 800000),
  ('development', 1, 'successful_runs', 1, 10000, 8000),
  ('development', 1, 'connector_calls', 1, 10000, 8000)
ON CONFLICT (plan_id, plan_version, metric_id, metric_version) DO NOTHING;
INSERT INTO account_plan_assignments(account_id, plan_id, plan_version, effective_from)
SELECT 'local-default', 'development', 1, '2020-01-01T00:00:00Z'
WHERE NOT EXISTS (
  SELECT 1 FROM account_plan_assignments
  WHERE account_id='local-default' AND plan_id='development' AND plan_version=1
);
