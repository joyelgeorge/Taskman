-- Streams the machine proposed for itself, kept apart from the ones declared by
-- hand — so "what did it find on its own" stays answerable, and a proposal built
-- from three scan rows is never mistaken for a considered decision.

ALTER TABLE income_streams ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'seed'
  CHECK (origin IN ('seed', 'discovered'));

-- Dedup key for a discovered stream: same evidence pattern, same fingerprint,
-- proposed once. This is also what stops a DISPROVEN stream being rediscovered
-- and re-proposed every single run — the row still exists, so the insert is a
-- no-op, and the disproof holds.
ALTER TABLE income_streams ADD COLUMN IF NOT EXISTS fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS income_streams_fingerprint_idx
  ON income_streams(fingerprint) WHERE fingerprint IS NOT NULL;

ALTER TABLE income_streams ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;
-- Which detector produced it, so a detector that only ever emits noise can be
-- identified and switched off by evidence rather than opinion.
ALTER TABLE income_streams ADD COLUMN IF NOT EXISTS detector TEXT;
