CREATE TABLE IF NOT EXISTS repo_execution_runs (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  branch_name TEXT NOT NULL,
  pr_number INTEGER,
  pr_url TEXT,
  head_sha TEXT,
  status TEXT NOT NULL DEFAULT 'STARTED',
  test_output TEXT,
  provider TEXT,
  model TEXT,
  token_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repo_execution_runs_repo_issue
  ON repo_execution_runs(repo, issue_number, created_at DESC);
