CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  goal TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_strength NUMERIC(6,5) NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  source_prompt TEXT NOT NULL,
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, version)
);

CREATE TABLE IF NOT EXISTS triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  cron_expression TEXT,
  interval_seconds INTEGER,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  next_fire_at TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_version INTEGER NOT NULL,
  scenario_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL,
  trigger_reason TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ,
  status TEXT NOT NULL,
  result JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_runs_task_created ON runs(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_scenario_created ON runs(scenario_id, created_at DESC);

CREATE TABLE IF NOT EXISTS run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  type TEXT NOT NULL,
  capability JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  input JSONB,
  output JSONB,
  error JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE(run_id, step_key, attempt)
);

CREATE TABLE IF NOT EXISTS knowledge_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id TEXT REFERENCES scenarios(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  key TEXT,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_type TEXT NOT NULL,
  confidence NUMERIC(6,5) NOT NULL DEFAULT 0.5,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  supersedes_event_id UUID REFERENCES knowledge_events(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_knowledge_scenario_time ON knowledge_events(scenario_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_task_time ON knowledge_events(task_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_type_time ON knowledge_events(type, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_value_gin ON knowledge_events USING GIN(value);

CREATE TABLE IF NOT EXISTS knowledge_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id TEXT REFERENCES scenarios(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  snapshot JSONB NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_task_time ON knowledge_snapshots(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_scenario_time ON knowledge_snapshots(scenario_id, created_at DESC);

CREATE TABLE IF NOT EXISTS strategy_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id TEXT REFERENCES scenarios(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  strategy_id TEXT NOT NULL,
  action TEXT NOT NULL,
  score_before NUMERIC,
  score_after NUMERIC,
  reason JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS future_paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id TEXT REFERENCES scenarios(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  based_on_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  next_strategy JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_experiments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  adapter_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  credential_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_tokens INTEGER,
  input_price NUMERIC,
  output_price NUMERIC,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS provider_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_endpoint_id UUID REFERENCES model_endpoints(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  latency_ms INTEGER,
  success BOOLEAN NOT NULL,
  error_class TEXT,
  cooldown_until TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  step_id UUID REFERENCES run_steps(id) ON DELETE SET NULL,
  provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
  model_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(18,8) NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_provider_time ON usage_events(provider_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS money_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  amount NUMERIC(18,8),
  currency TEXT,
  attributable_value NUMERIC(18,8),
  confidence NUMERIC(6,5) NOT NULL DEFAULT 0.5,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_money_scenario_time ON money_events(scenario_id, occurred_at DESC);
