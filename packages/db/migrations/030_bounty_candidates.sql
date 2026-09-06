-- Migration 030: Add bounty_candidates table for human-gated PR review (Issue #194)
-- External PRs must never be auto-submitted by the machine.
-- Candidates are prepared and stored for human decision.

CREATE TABLE IF NOT EXISTS bounty_candidates (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  branch_name TEXT,
  status TEXT NOT NULL DEFAULT 'READY_FOR_REVIEW'
    CHECK (status IN ('READY_FOR_REVIEW', 'DISCARDED', 'REFUSED_POLICY_BAN', 'SUBMITTED_BY_HUMAN')),
  policy_verdict TEXT,
  policy_reason TEXT,
  policy_ref TEXT,
  disclosure_text TEXT,
  proposed_changes TEXT,
  test_output TEXT,
  submission_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bounty_candidates_repo_status_idx ON bounty_candidates(repo, status);
CREATE INDEX IF NOT EXISTS bounty_candidates_created_at_idx ON bounty_candidates(created_at DESC);
