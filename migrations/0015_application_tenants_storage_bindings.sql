BEGIN;

-- Application-domain tenants (not Trust workspaces).
CREATE TABLE application_tenants (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  application_id uuid NOT NULL REFERENCES application_registrations (id),
  external_tenant_key text NOT NULL CHECK (length(btrim(external_tenant_key)) > 0),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, application_id, external_tenant_key)
);

ALTER TABLE application_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_application_tenants ON application_tenants
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);

CREATE TABLE storage_profiles (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  provider text NOT NULL CHECK (provider IN ('minio', 's3')),
  region text NOT NULL,
  bucket text NOT NULL,
  prefix text NOT NULL DEFAULT '',
  tier text NOT NULL CHECK (tier IN ('managed', 'byob', 'premium')),
  credential_mode text NOT NULL CHECK (credential_mode IN (
    'platform_iam',
    'cross_account_role',
    'static_keys_ref',
    'missing'
  )),
  expected_bucket_owner text,
  endpoint_host text,
  role_arn text,
  external_id_hash text,
  declared_plan_code text,
  declared_capacity_bytes bigint,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE storage_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_storage_profiles ON storage_profiles
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);

CREATE TABLE storage_bindings (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  application_id uuid NOT NULL REFERENCES application_registrations (id),
  application_tenant_id uuid REFERENCES application_tenants (id),
  profile_id uuid NOT NULL REFERENCES storage_profiles (id),
  status text NOT NULL CHECK (status IN (
    'draft',
    'awaiting_customer_role',
    'configured',
    'connected',
    'needs_attention',
    'disabled',
    'migrating'
  )),
  generation bigint NOT NULL DEFAULT 1,
  last_probe_ok boolean,
  last_probe_at timestamptz,
  last_probe_summary text,
  last_issue_class text,
  plan_sync_state text NOT NULL DEFAULT 'unknown' CHECK (plan_sync_state IN (
    'synced',
    'drift_detected',
    'upgrade_recognised',
    'unknown',
    'over_capacity'
  )),
  observed_usage_bytes bigint,
  observed_quota_bytes bigint,
  observed_at timestamptz,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX storage_bindings_app_default_unique
  ON storage_bindings (workspace_id, application_id)
  WHERE application_tenant_id IS NULL;

CREATE UNIQUE INDEX storage_bindings_tenant_unique
  ON storage_bindings (workspace_id, application_id, application_tenant_id)
  WHERE application_tenant_id IS NOT NULL;

ALTER TABLE storage_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_storage_bindings ON storage_bindings
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);

CREATE TABLE storage_binding_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  binding_id uuid NOT NULL REFERENCES storage_bindings (id),
  generation bigint NOT NULL,
  snapshot_json jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL
);

ALTER TABLE storage_binding_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_binding_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_storage_binding_versions ON storage_binding_versions
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);

ALTER TABLE blob_objects
  ADD COLUMN IF NOT EXISTS storage_binding_id uuid,
  ADD COLUMN IF NOT EXISTS storage_binding_generation bigint;

COMMIT;
