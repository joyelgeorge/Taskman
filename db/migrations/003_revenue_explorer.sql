CREATE TABLE IF NOT EXISTS revenue_records (
  id UUID PRIMARY KEY,
  queue TEXT NOT NULL,
  novelty_key TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',
  priority INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS revenue_records_queue_novelty_key_uidx
  ON revenue_records(queue, novelty_key)
  WHERE novelty_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS revenue_records_queue_status_priority_idx
  ON revenue_records(queue, status, priority DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS revenue_scan_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
