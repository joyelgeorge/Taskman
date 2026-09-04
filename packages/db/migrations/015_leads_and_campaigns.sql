-- Campaigns and candidate buyer leads schema for marketing and acquisition.
-- See docs/MARKETING_FINANCE_WING.md §4.5 and Issue #130.

CREATE TABLE IF NOT EXISTS campaigns (
  campaign_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lane TEXT NOT NULL,
  value_proposition TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'SCOPING',
  probation_budget_cents BIGINT NOT NULL DEFAULT 5000,
  probation_epoch INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_status_check CHECK (status IN ('SCOPING', 'ACTIVE', 'PAUSED', 'KILLED'))
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_key TEXT NOT NULL REFERENCES campaigns(campaign_key) ON DELETE CASCADE,
  source TEXT NOT NULL,
  raw_record JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact_hint TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leads_source_check CHECK (source IN ('drone', 'manual')),
  CONSTRAINT leads_status_check CHECK (status IN ('NEW', 'QUALIFIED', 'REJECTED', 'CONVERTED'))
);

CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_key);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
