-- The table src/transforms/outreach-draft.js has always written to, and which no
-- migration ever created.
--
-- The write was wrapped in a catch that fell back to an in-process Map and still
-- returned ok:true, so in PostgreSQL mode every draft was silently discarded and
-- reported as saved. That is the same silent-success failure this system exists
-- to eliminate; the fallback is gone and the table now exists.

CREATE TABLE IF NOT EXISTS outreach_drafts (
  -- TEXT, not UUID: ids are generated as `draft-<timestamp>-<random>`. The
  -- memory store accepted any string, so the mismatch only surfaced once the
  -- write actually reached PostgreSQL.
  id TEXT PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  campaign_key TEXT REFERENCES campaigns(campaign_key) ON DELETE CASCADE,
  subject TEXT,
  draft_text TEXT NOT NULL,
  -- A draft is never sent by the machine. Outreach leaves this system only when a
  -- human approves it, so the states stop at APPROVED and nothing marks SENT here.
  status TEXT NOT NULL DEFAULT 'READY_FOR_REVIEW'
    CHECK (status IN ('READY_FOR_REVIEW', 'APPROVED', 'REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outreach_drafts_status_idx ON outreach_drafts(status);
