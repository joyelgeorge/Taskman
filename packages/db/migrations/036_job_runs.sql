-- One row per stage of a revenue job, written before the stage's result is
-- returned to its caller.
--
-- docs/WHY-NO-MONEY-YET.md: nothing in this repository ever counted an attempt,
-- so KILL_AFTER_ATTEMPTS and breakEvenRateFor could never fire and no lane could
-- be honestly proven or retired. With no count, "we tried and it did not work"
-- and "nobody tried" are indistinguishable from inside the repo.
--
-- Refusals are recorded as carefully as successes. A gate that stops something
-- silently teaches nobody anything, and "the human gate refused this 40 times"
-- is a finding about the operator's attention, not noise.

CREATE TABLE IF NOT EXISTS job_runs (
  id        UUID PRIMARY KEY,
  job       TEXT NOT NULL,
  rail      TEXT,
  stage     TEXT NOT NULL CHECK (stage IN
              ('connect','listen','detect','intervene','verify','measure','charge')),
  outcome   TEXT NOT NULL CHECK (outcome IN ('OK','REFUSED','FAILED')),
  reason    TEXT,
  -- Who approved an intervene. NULL everywhere else, and NULL on a refused
  -- intervene, which is what an unapproved attempt looks like.
  approval  TEXT,
  ran_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_runs_job_idx ON job_runs (job, ran_at DESC);
CREATE INDEX IF NOT EXISTS job_runs_outcome_idx ON job_runs (outcome);
