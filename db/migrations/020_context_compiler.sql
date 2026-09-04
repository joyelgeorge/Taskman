CREATE TABLE IF NOT EXISTS compiled_context_manifests (
  id TEXT PRIMARY KEY,
  caller_stage TEXT NOT NULL,
  candidate_id TEXT,
  digest_sha256 TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  manifest_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compiled_context_manifests_cand
  ON compiled_context_manifests(caller_stage, candidate_id, created_at DESC);
