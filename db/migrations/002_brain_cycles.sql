CREATE TABLE IF NOT EXISTS brain_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  gap TEXT,
  scenario_score NUMERIC,
  status TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  result JSONB,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_brain_cycles_time ON brain_cycles(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_cycles_scenario_time ON brain_cycles(scenario_id, started_at DESC);
