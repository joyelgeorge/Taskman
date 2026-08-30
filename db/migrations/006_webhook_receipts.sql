CREATE TABLE IF NOT EXISTS webhook_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  processing_state TEXT NOT NULL DEFAULT 'RECEIVED',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  last_error_code TEXT,
  UNIQUE(provider, delivery_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_receipts_state_time
  ON webhook_receipts(processing_state, received_at);
