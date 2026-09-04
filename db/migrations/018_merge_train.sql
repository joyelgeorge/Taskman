CREATE TABLE IF NOT EXISTS merge_train_records (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  base_branch TEXT NOT NULL DEFAULT 'main',
  head_sha TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'QUEUED',
  gate_verdicts JSONB NOT NULL DEFAULT '{}'::jsonb,
  merge_commit_sha TEXT,
  post_merge_status TEXT,
  rollback_sha TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merge_train_repo_status
  ON merge_train_records(repo, status, created_at ASC);
