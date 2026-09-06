-- Widen income_streams.origin to cover streams a person creates.
--
-- Migration 025 allowed only ('seed', 'discovered') — written when the only two
-- ways a stream could exist were declared-in-code and found-by-a-detector. The
-- operator console then added a third: a human typing one in. That is a real and
-- distinct provenance, but the constraint rejected it, so POST /api/money/
-- opportunities returned 500 against PostgreSQL and the feature could not be used
-- at all. Memory mode has no constraint, which is why it passed there.
--
-- Both human values in use are kept rather than collapsed into one: the API
-- defaults to operator_ui and packages/web/public/operator.js sends local_entry,
-- and rewriting live rows to normalise a label is not worth a data migration.

ALTER TABLE income_streams DROP CONSTRAINT IF EXISTS income_streams_origin_check;
ALTER TABLE income_streams ADD CONSTRAINT income_streams_origin_check
  CHECK (origin IN ('seed', 'discovered', 'operator_ui', 'local_entry'));
