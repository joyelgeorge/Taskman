-- Longitudinal observation store — see docs/DATA_ECOSYSTEM.md.
--
-- The asset here is history, not volume. Anyone can fetch today's number; the
-- clean daily series of it is what compounds. So retention is part of the
-- schema rather than something discovered when the free tier fills up: raw
-- rows are pruned after ~90 days, and the daily rollup — roughly 1/100th the
-- size and what any downstream question actually needs — is kept indefinitely.

CREATE TABLE IF NOT EXISTS observation_sources (
  source_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- A series whose licence is unknown is not collected. Recorded, not implied.
  licence TEXT NOT NULL,
  decision TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  interval_seconds INTEGER NOT NULL DEFAULT 86400,
  last_run_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT observation_sources_kind_known CHECK (kind IN ('http_json', 'http_xml'))
);

CREATE TABLE IF NOT EXISTS observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL REFERENCES observation_sources(source_key) ON DELETE CASCADE,
  series_key TEXT NOT NULL,
  value_num NUMERIC(24,10),
  value_text TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Re-collecting the same point is a no-op rather than a duplicate, so a cron
-- that runs twice in a slot cannot corrupt a series.
CREATE UNIQUE INDEX IF NOT EXISTS observations_series_point_uidx
  ON observations(series_key, observed_at);
CREATE INDEX IF NOT EXISTS idx_observations_series_time ON observations(series_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_prune ON observations(observed_at);

-- The part that is actually the asset. ~200 bytes per series per day: one
-- series over ten years is well under a megabyte, so this is kept forever
-- while the raw rows above are disposable.
CREATE TABLE IF NOT EXISTS observation_rollups (
  series_key TEXT NOT NULL,
  bucket_date DATE NOT NULL,
  sample_count INTEGER NOT NULL,
  value_min NUMERIC(24,10),
  value_max NUMERIC(24,10),
  value_avg NUMERIC(24,10),
  value_last NUMERIC(24,10),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (series_key, bucket_date)
);

CREATE INDEX IF NOT EXISTS idx_rollups_series_date ON observation_rollups(series_key, bucket_date DESC);
