CREATE TABLE IF NOT EXISTS evidence_cache_entries (
  claim_key TEXT PRIMARY KEY,
  normalized_statement TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  freshness_class TEXT NOT NULL,
  schema_revision TEXT NOT NULL DEFAULT '1',
  status TEXT NOT NULL DEFAULT 'VALID',
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reuse_count INTEGER NOT NULL DEFAULT 0,
  estimated_tokens_saved INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_evidence_cache_status_exp
  ON evidence_cache_entries(status, expires_at);
