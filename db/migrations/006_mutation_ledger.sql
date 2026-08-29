-- Migration 006: Mutation Idempotency Ledger
CREATE TABLE IF NOT EXISTS mutation_ledger (
  idempotency_key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  route TEXT NOT NULL,
  status TEXT NOT NULL, -- IN_PROGRESS, COMPLETED, FAILED
  response_status INT,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_mutation_ledger_expires_at ON mutation_ledger(expires_at);
