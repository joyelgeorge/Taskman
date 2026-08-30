CREATE TABLE IF NOT EXISTS credential_references (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  allowed_capabilities TEXT[] NOT NULL DEFAULT '{}',
  allowed_modes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'staged', 'revoked', 'expired', 'disabled')),
  active_version TEXT,
  next_version TEXT,
  expires_at TIMESTAMPTZ,
  rotation_due_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credential_reference_versions (
  credential_ref TEXT NOT NULL REFERENCES credential_references(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staged', 'active', 'retiring', 'revoked')),
  not_before TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (credential_ref, version)
);

CREATE INDEX IF NOT EXISTS idx_credential_refs_scope
  ON credential_references(account_id, provider_id, environment, status);

COMMENT ON TABLE credential_references IS 'Non-secret metadata only; secret values and backend credentials must never be stored here';
