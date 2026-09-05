-- Bayesian beta-distribution source weight tracker for signal source quality.
-- Each source starts with alpha=8, beta=2 (prior weight 0.8, curated sources).
-- WIN outcomes increment alpha; LOSS outcomes increment beta.
-- See Issue #190, item 4.

CREATE TABLE IF NOT EXISTS source_weight_updates (
  source_key TEXT PRIMARY KEY,
  alpha      INTEGER NOT NULL DEFAULT 8,
  beta       INTEGER NOT NULL DEFAULT 2,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
