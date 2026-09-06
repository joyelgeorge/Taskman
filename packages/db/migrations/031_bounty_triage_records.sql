-- Migration 031: Bounty Triage Records & Yield Monitoring (Issue #195)
-- Captures raw listings, triage verdicts, failed gates, and explicit argument reasons
-- to empirically track noise rate vs viable agent yield (target 1-2%).

CREATE TABLE IF NOT EXISTS bounty_triage_records (
  id TEXT PRIMARY KEY,
  listing_key TEXT NOT NULL,
  repo TEXT NOT NULL,
  issue_number INTEGER,
  title TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('VIABLE', 'REJECTED')),
  failed_gate TEXT CHECK (failed_gate IN ('TRAP_CHECK', 'FUNDING_CHECK', 'REACHABILITY_CHECK', 'SCOPE_CHECK', 'AI_POLICY_CHECK')),
  reason TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  triaged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bounty_triage_verdict_idx ON bounty_triage_records(verdict);
CREATE INDEX IF NOT EXISTS bounty_triage_gate_idx ON bounty_triage_records(failed_gate);
CREATE INDEX IF NOT EXISTS bounty_triage_triaged_at_idx ON bounty_triage_records(triaged_at DESC);
