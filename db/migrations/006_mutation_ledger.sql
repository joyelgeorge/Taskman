-- Durable HTTP mutation replay ledger. Caller keys are stored only as SHA-256 digests.
CREATE TABLE IF NOT EXISTS mutation_ledger (
  scope TEXT NOT NULL,
  route TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  operation_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  response_status INTEGER,
  response_body JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, route, key_hash)
);

CREATE INDEX IF NOT EXISTS idx_mutation_ledger_expiry
  ON mutation_ledger (expires_at);
