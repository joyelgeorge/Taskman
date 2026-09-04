CREATE TABLE IF NOT EXISTS model_routing_decisions (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  task_class TEXT NOT NULL,
  selected_tier TEXT NOT NULL,
  escalated_from_tier TEXT,
  escalation_reason TEXT,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  outcome_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_routing_task_tier
  ON model_routing_decisions(task_class, selected_tier, created_at DESC);
