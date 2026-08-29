-- Migration 005: add lease_token for fencing stale-lease races
-- lease_token is a UUID minted at claim time and returned to the worker in the claim ticket.
-- finishScheduledJobRun uses WHERE run_key = $runKey AND lease_token = $leaseToken
-- so a late-waking stale worker (A) cannot overwrite the active lease of the new owner (B).

ALTER TABLE scheduled_jobs ADD COLUMN IF NOT EXISTS lease_token UUID;
ALTER TABLE scheduled_job_runs ADD COLUMN IF NOT EXISTS lease_token UUID;
