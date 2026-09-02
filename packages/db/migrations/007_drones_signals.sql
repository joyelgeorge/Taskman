-- Drones: autonomous collectors that reach the internet and emit signals.
-- A drone is deterministic by contract. It fetches, extracts and fingerprints;
-- it never reasons about what it found. Interpretation happens downstream.

CREATE TABLE IF NOT EXISTS drones (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  interval_seconds INTEGER NOT NULL DEFAULT 3600,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  quarantined_until TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT drones_kind_known CHECK (kind IN ('http_json','rss','page_watch'))
);

CREATE INDEX IF NOT EXISTS idx_drones_due ON drones(enabled, last_run_at);

CREATE TABLE IF NOT EXISTS signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drone_id TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  url TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'NEW',
  score NUMERIC(6,4),
  reject_reason TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT signals_status_known CHECK (status IN ('NEW','PROCESSED','REJECTED','QUARANTINED'))
);

-- The same observation is never ingested twice, however often a drone flies.
CREATE UNIQUE INDEX IF NOT EXISTS signals_drone_fingerprint_uidx ON signals(drone_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_signals_status_time ON signals(status, created_at DESC);

CREATE TABLE IF NOT EXISTS drone_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drone_id TEXT NOT NULL REFERENCES drones(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  signals_seen INTEGER NOT NULL DEFAULT 0,
  signals_new INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_drone_runs_drone_time ON drone_runs(drone_id, started_at DESC);
