-- Proposed changes to the system, produced by the improve cron from observed
-- evidence. Proposals are inert records: nothing here edits code or config.
-- A human moves a row to ACCEPTED, which is the only authority to act on it.

CREATE TABLE IF NOT EXISTS improvements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  proposed_change TEXT NOT NULL,
  expected_impact TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  score NUMERIC(6,4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PROPOSED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  CONSTRAINT improvements_status_known CHECK (status IN ('PROPOSED','ACCEPTED','REJECTED','APPLIED')),
  CONSTRAINT improvements_source_known CHECK (source IN ('revenue_gap','health','cron_failure','drone_yield','research'))
);

-- The same proposal is not re-raised every run while it sits undecided.
CREATE UNIQUE INDEX IF NOT EXISTS improvements_open_fingerprint_uidx
  ON improvements(fingerprint) WHERE status = 'PROPOSED';
CREATE INDEX IF NOT EXISTS idx_improvements_status_score ON improvements(status, score DESC);
