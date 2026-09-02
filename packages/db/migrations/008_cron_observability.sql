-- Cron observability. A scheduled job that silently stops running is the most
-- expensive failure in an autonomous system, because nothing reports an error --
-- the work simply never happens. Every run is recorded so absence is detectable.

CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name TEXT NOT NULL,
  run_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  host TEXT,
  duration_ms INTEGER,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT cron_runs_status_known CHECK (status IN ('RUNNING','COMPLETED','FAILED','TIMED_OUT'))
);

-- Two runners firing the same scheduled slot collapse into one row.
CREATE UNIQUE INDEX IF NOT EXISTS cron_runs_name_key_uidx ON cron_runs(cron_name, run_key);
CREATE INDEX IF NOT EXISTS idx_cron_runs_name_time ON cron_runs(cron_name, started_at DESC);

-- What the watchdog expects to see. A cron absent from here is unmonitored,
-- so registration is part of defining a cron, not an afterthought.
CREATE TABLE IF NOT EXISTS cron_expectations (
  cron_name TEXT PRIMARY KEY,
  schedule TEXT NOT NULL,
  max_silence_seconds INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS component_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT component_health_status_known CHECK (status IN ('OK','DEGRADED','DOWN'))
);

CREATE INDEX IF NOT EXISTS idx_component_health_time ON component_health(component, checked_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'WARNING',
  component TEXT NOT NULL,
  message TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT alerts_severity_known CHECK (severity IN ('INFO','WARNING','CRITICAL'))
);

-- One open alert per (kind, component): a flapping component pages once, not hourly.
CREATE UNIQUE INDEX IF NOT EXISTS alerts_open_uidx ON alerts(kind, component) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(resolved_at, opened_at DESC);
