-- What a research pass found, kept past the session that found it.
--
-- The vibe-app sweep wrote its results to /tmp and lost them. A finding that
-- lives only in a transcript dies with it, and the next session either pays to
-- rediscover it or half-remembers one and states it as fact.
--
-- tier is constrained rather than free text because the whole value of the row
-- is that a later reader can tell a checked fact from a hunch. A note may be a
-- HYPOTHESIS with no source; it may not be REFERENCED or CONFIRMED without one,
-- and that rule is enforced in src/research-log.js where the source is present.

CREATE TABLE IF NOT EXISTS research_notes (
  id           UUID PRIMARY KEY,
  claim        TEXT NOT NULL,
  tier         TEXT NOT NULL CHECK (tier IN ('HYPOTHESIS', 'REFERENCED', 'CONFIRMED')),
  -- Anything a later reader could go and check: a URL, a file and line, a
  -- command and what it printed. NULL only for a HYPOTHESIS.
  source       TEXT,
  lane         TEXT,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_notes_recorded_idx ON research_notes (recorded_at DESC);
CREATE INDEX IF NOT EXISTS research_notes_lane_idx ON research_notes (lane);

ALTER TABLE research_notes
  ADD CONSTRAINT research_notes_sourced_unless_hypothesis
  CHECK (tier = 'HYPOTHESIS' OR source IS NOT NULL);
