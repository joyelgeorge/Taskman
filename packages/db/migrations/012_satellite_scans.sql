-- Satellite scans: reconnaissance of a candidate money-flow venue, not collection
-- from an approved source. A drone (007) repeatedly pulls items from a source
-- already trusted to be worth watching; a satellite scan answers the prior
-- question — is this venue even reachable by an automated client, and what shape
-- is it (job board / catalog / single-lookup registry / bulk data) — the exact
-- manual reconnaissance done by hand for Upwork, Fiverr, and California's
-- unclaimed-property registry, now run on a schedule instead of once.

CREATE TABLE IF NOT EXISTS satellite_targets (
  target_key TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  category TEXT,
  notes TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS satellite_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_key TEXT NOT NULL REFERENCES satellite_targets(target_key) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  reachable BOOLEAN NOT NULL,
  http_status INTEGER,
  bot_defended BOOLEAN NOT NULL DEFAULT FALSE,
  bot_defense_vendor TEXT,
  bot_defense_signal TEXT,
  shape TEXT NOT NULL DEFAULT 'unknown',
  shape_confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  latency_ms INTEGER,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT satellite_scans_shape_known CHECK (
    shape IN ('job_board', 'catalog', 'single_lookup', 'bulk_data', 'unknown')
  )
);

CREATE INDEX IF NOT EXISTS idx_satellite_scans_target_time ON satellite_scans(target_key, scanned_at DESC);

-- The most recent scan per target — what a dashboard or the next scheduled run
-- actually needs, without scanning the full append-only history.
CREATE OR REPLACE VIEW satellite_scans_latest AS
SELECT DISTINCT ON (target_key) *
FROM satellite_scans
ORDER BY target_key, scanned_at DESC;
