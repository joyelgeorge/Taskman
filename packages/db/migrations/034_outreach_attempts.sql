-- A record that an attempt was actually made.
--
-- Kill criteria exist all over this system — commercial-wedge.js retires the
-- wedge after 50 attempts with zero conversions, rail-governor derives its own
-- thresholds — and none of them could ever fire, because nothing counted an
-- attempt. acquisition-funnel.js names the stages and holds them in memory,
-- where they vanish with the process.
--
-- Without this table "we tried and it did not work" and "nobody tried" are the
-- same observation from inside the repo, and the default when those two cannot
-- be distinguished is always to build.
--
-- One row per message actually sent to an actual person. Not a plan to send one.

CREATE TABLE IF NOT EXISTS outreach_attempts (
  id           uuid PRIMARY KEY,
  lane         text        NOT NULL,
  channel      text        NOT NULL,
  prospect     text        NOT NULL,
  outcome      text        NOT NULL DEFAULT 'PENDING',
  note         text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT outreach_attempts_outcome_check
    CHECK (outcome IN ('PENDING','NO_RESPONSE','REPLIED','DECLINED','INTERESTED','PAID'))
);

-- Contacting the same person twice on the same channel is a mistake worth
-- preventing at the storage layer, not only in the application.
CREATE UNIQUE INDEX IF NOT EXISTS outreach_attempts_prospect_idx
  ON outreach_attempts (lane, channel, prospect);

CREATE INDEX IF NOT EXISTS outreach_attempts_lane_idx ON outreach_attempts (lane, attempted_at DESC);
