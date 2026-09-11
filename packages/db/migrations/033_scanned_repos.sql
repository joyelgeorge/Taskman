-- Memory for the vibe-coded-app sweep.
--
-- Before this, scripts/hunt-vibe-leads.mjs regenerated its candidate list from
-- GitHub search on every run and kept no record of what it had already looked
-- at. So each Monday it re-cloned and re-scanned the same top-starred repos,
-- spending the whole budget rediscovering last week's findings, and the
-- candidate pool never grew past what one search returned.
--
-- This table is that memory: what was scanned, when, and how it came out. The
-- sweep skips anything scanned recently and spends its budget on repos it has
-- not seen.
--
-- It deliberately stores NO finding detail. Classes and counts live on the lead
-- record; a file path or an excerpt is never persisted anywhere.

CREATE TABLE IF NOT EXISTS scanned_repos (
  repo         text PRIMARY KEY,
  scanned_at   timestamptz NOT NULL DEFAULT now(),
  outcome      text        NOT NULL,
  finding_count integer    NOT NULL DEFAULT 0,
  scan_count   integer     NOT NULL DEFAULT 1,
  CONSTRAINT scanned_repos_outcome_check
    CHECK (outcome IN ('LEAD', 'CLEAN', 'VULN_NOT_BUSINESS', 'ERROR'))
);

CREATE INDEX IF NOT EXISTS scanned_repos_scanned_at_idx ON scanned_repos (scanned_at DESC);
CREATE INDEX IF NOT EXISTS scanned_repos_outcome_idx    ON scanned_repos (outcome);
