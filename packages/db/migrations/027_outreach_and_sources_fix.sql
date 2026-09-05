-- Expand observation_sources kind check constraint to allow 'rss'
ALTER TABLE observation_sources DROP CONSTRAINT IF EXISTS observation_sources_kind_known;
ALTER TABLE observation_sources ADD CONSTRAINT observation_sources_kind_known
  CHECK (kind IN ('http_json', 'http_xml', 'http_json_ranked', 'rss'));

-- Add updated_at column to outreach_drafts and expand status constraint for human review lifecycle
ALTER TABLE outreach_drafts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE outreach_drafts DROP CONSTRAINT IF EXISTS outreach_drafts_status_check;
ALTER TABLE outreach_drafts ADD CONSTRAINT outreach_drafts_status_check
  CHECK (status IN ('READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'DISCARDED', 'SENT', 'REPLIED', 'DECLINED', 'CONVERTED'));
