ALTER TABLE revenue_records
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_kind TEXT,
  ADD COLUMN IF NOT EXISTS last_redrive_key_hash TEXT,
  ADD COLUMN IF NOT EXISTS redrive_reason TEXT;

ALTER TABLE revenue_records DROP CONSTRAINT IF EXISTS revenue_records_attempt_count_check;
ALTER TABLE revenue_records ADD CONSTRAINT revenue_records_attempt_count_check CHECK (attempt_count >= 0);
ALTER TABLE revenue_records DROP CONSTRAINT IF EXISTS revenue_records_max_attempts_check;
ALTER TABLE revenue_records ADD CONSTRAINT revenue_records_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 20);

CREATE INDEX IF NOT EXISTS revenue_records_retry_claim_idx
  ON revenue_records(queue, next_attempt_at, priority DESC, created_at ASC)
  WHERE status = 'RETRY_PENDING' AND dead_lettered_at IS NULL;

CREATE INDEX IF NOT EXISTS revenue_records_dead_letter_idx
  ON revenue_records(queue, dead_lettered_at DESC)
  WHERE status = 'DEAD_LETTER';
