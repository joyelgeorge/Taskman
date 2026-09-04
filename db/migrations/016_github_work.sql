CREATE TABLE IF NOT EXISTS github_work_items (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  base_priority INTEGER NOT NULL DEFAULT 100,
  effective_priority INTEGER NOT NULL DEFAULT 100,
  blocker_issue_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocking_issue_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_pr JSONB,
  eligibility_status TEXT NOT NULL DEFAULT 'READY',
  eligibility_reason TEXT NOT NULL DEFAULT '',
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  github_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo, issue_number)
);

CREATE INDEX IF NOT EXISTS idx_github_work_status
  ON github_work_items(repo, eligibility_status, effective_priority DESC, issue_number ASC);
