CREATE TABLE IF NOT EXISTS strategic_objectives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  desired_outcome TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  budget_cents INTEGER NOT NULL DEFAULT 0,
  spent_cents INTEGER NOT NULL DEFAULT 0,
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  success_metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  kill_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_boundaries JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategic_objectives_status_priority
  ON strategic_objectives(status, priority DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS strategic_directives (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES strategic_objectives(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  author TEXT NOT NULL DEFAULT 'human',
  directive_text TEXT NOT NULL,
  rationale TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategic_directives_obj_ver
  ON strategic_directives(objective_id, version DESC);
