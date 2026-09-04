CREATE TABLE IF NOT EXISTS customer_workspaces (
  workspace_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agency_name TEXT NOT NULL,
  fiverr_username TEXT NOT NULL,
  monthly_volume_estimate_cents BIGINT NOT NULL DEFAULT 0,
  notification_email TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIGURED' CHECK (status IN ('CONFIGURED', 'READY', 'ACTIVE', 'PAUSED')),
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  integrations JSONB NOT NULL DEFAULT '{}'::jsonb,
  economic_taxonomy JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customer_workspaces_tenant
  ON customer_workspaces(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_reconciliation_artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES customer_workspaces(workspace_id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('FIVERR_ACTIVITY_CSV', 'BANK_DEPOSIT_CSV', 'RECONCILIATION_REPORT_JSON')),
  file_name TEXT NOT NULL,
  file_hash_sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  quarantine_status TEXT NOT NULL DEFAULT 'CLEARED' CHECK (quarantine_status IN ('CLEARED', 'QUARANTINED', 'REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_artifacts_workspace
  ON customer_reconciliation_artifacts(workspace_id, created_at DESC);
