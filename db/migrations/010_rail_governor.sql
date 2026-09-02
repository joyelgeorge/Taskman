-- The four-state rail governor (docs/TARGET_DESIGN.md §8).
--
-- rail_state.enabled (006) was a human-settable boolean. It becomes a value
-- DERIVED from `state`, so there is exactly one place a rail's aliveness is
-- decided, and "enabled" can no longer drift out of sync with the state machine
-- that actually governs spend.

ALTER TABLE rail_state ADD COLUMN IF NOT EXISTS state TEXT;

-- Carry forward whatever a pre-governor deployment already decided.
UPDATE rail_state SET state = CASE WHEN enabled THEN 'PROBATION' ELSE 'DISABLED' END
WHERE state IS NULL;

ALTER TABLE rail_state ALTER COLUMN state SET DEFAULT 'PROBATION';
ALTER TABLE rail_state ALTER COLUMN state SET NOT NULL;
ALTER TABLE rail_state ADD CONSTRAINT rail_state_state_known
  CHECK (state IN ('PROBATION', 'PROVEN', 'SCALED', 'DISABLED'));

-- probation_started_at is display-only ("when did this window start"). The
-- correctness mechanism for windowed checks is probation_epoch below: a wall-clock
-- boundary cannot safely separate "before re-enable" from "after" when two writes
-- land in the same instant, which happens routinely under real concurrency and
-- was reproducible even in single-threaded tests with no I/O between steps.
ALTER TABLE rail_state ADD COLUMN IF NOT EXISTS probation_started_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE rail_state ADD COLUMN IF NOT EXISTS state_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Incremented every time a rail enters PROBATION (including its first-ever
-- registration). rail_attempts and settlements are stamped with the epoch that
-- was current when they were written, so "spend/settlements in the current
-- probation window" is an exact equality filter, not a timestamp comparison.
ALTER TABLE rail_state ADD COLUMN IF NOT EXISTS probation_epoch INTEGER NOT NULL DEFAULT 0;

ALTER TABLE rail_state DROP COLUMN enabled;
ALTER TABLE rail_state ADD COLUMN enabled BOOLEAN GENERATED ALWAYS AS (state <> 'DISABLED') STORED;

ALTER TABLE rail_attempts ADD COLUMN IF NOT EXISTS probation_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS probation_epoch INTEGER NOT NULL DEFAULT 0;

-- A cap on spend across every rail combined, so a fleet of rails each individually
-- inside their own probation budget cannot collectively drain the account. One
-- row by convention (id='default'); nothing here prevents adding more scopes later.
CREATE TABLE IF NOT EXISTS global_budget (
  id TEXT PRIMARY KEY DEFAULT 'default',
  monthly_cap_cents BIGINT NOT NULL DEFAULT 50000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO global_budget(id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- rail_economics (006) now also reports the governed state, so a caller of
-- railEconomics() can render PROBATION/PROVEN/SCALED/DISABLED without a second
-- query. A rail with no attempts or settlements yet but a rail_state row (freshly
-- registered) still appears, defaulting to PROBATION.
CREATE OR REPLACE VIEW rail_economics AS
SELECT
  r.rail,
  COALESCE(a.attempts, 0)                                   AS attempts,
  COALESCE(a.spend_cents, 0)                                AS spend_cents,
  COALESCE(s.cleared_count, 0)                              AS cleared_count,
  COALESCE(s.cleared_cents, 0)                              AS cleared_cents,
  COALESCE(s.pending_cents, 0)                              AS pending_cents,
  COALESCE(s.cleared_cents, 0) - COALESCE(a.spend_cents, 0) AS net_cents,
  COALESCE(rs.state, 'PROBATION')                           AS state,
  rs.disabled_reason                                        AS disabled_reason
FROM (
  SELECT rail FROM rail_attempts
  UNION
  SELECT rail FROM settlements
  UNION
  SELECT rail FROM rail_state
) r
LEFT JOIN (
  SELECT rail, COUNT(*) AS attempts, SUM(cost_cents) AS spend_cents
  FROM rail_attempts GROUP BY rail
) a ON a.rail = r.rail
LEFT JOIN (
  SELECT rail,
         COUNT(*) FILTER (WHERE status = 'CLEARED')                         AS cleared_count,
         COALESCE(SUM(net_cents) FILTER (WHERE status = 'CLEARED'), 0)      AS cleared_cents,
         COALESCE(SUM(net_cents) FILTER (WHERE status = 'PENDING'), 0)      AS pending_cents
  FROM settlements GROUP BY rail
) s ON s.rail = r.rail
LEFT JOIN rail_state rs ON rs.rail = r.rail;
