BEGIN;

CREATE TABLE application_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  namespace text NOT NULL,
  name text NOT NULL,
  application_version text NOT NULL,
  schema_package_ids uuid[] NOT NULL DEFAULT '{}',
  capabilities_json jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, namespace)
);

CREATE TABLE policy_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'service', 'application')),
  principal_id text NOT NULL,
  role text NOT NULL,
  scope_kind text NOT NULL CHECK (scope_kind IN ('workspace', 'dataset', 'application')),
  scope_id text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX policy_assignment_active_idx
  ON policy_assignments(workspace_id, principal_type, principal_id, role, scope_kind, scope_id)
  WHERE revoked_at IS NULL;

CREATE TABLE break_glass_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  principal_id text NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  actions_json jsonb NOT NULL,
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > granted_at)
);
CREATE INDEX break_glass_active_idx
  ON break_glass_grants(workspace_id, principal_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE verification_runs NO FORCE ROW LEVEL SECURITY;
ALTER TABLE verification_runs
  ADD COLUMN scope_kind text NOT NULL DEFAULT 'workspace'
    CHECK (scope_kind IN ('blob', 'resource', 'dataset', 'workspace')),
  ADD COLUMN scope_id text;
UPDATE verification_runs SET scope_id = workspace_id::text WHERE scope_id IS NULL;
ALTER TABLE verification_runs ALTER COLUMN scope_id SET NOT NULL;
ALTER TABLE verification_runs FORCE ROW LEVEL SECURITY;
CREATE INDEX verification_scope_time_idx
  ON verification_runs(workspace_id, scope_kind, scope_id, started_at DESC);

ALTER TABLE operations ADD CONSTRAINT operations_id_workspace_unique UNIQUE (id, workspace_id);
CREATE TABLE upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  operation_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN (
    'requested', 'authorised', 'temporary_upload_created', 'bytes_received',
    'hash_verified', 'immutable_object_committed', 'metadata_committed',
    'audit_committed', 'completed', 'rejected', 'failed_retryable',
    'failed_terminal', 'quarantined'
  )),
  media_type text NOT NULL,
  expected_byte_length bigint CHECK (expected_byte_length IS NULL OR expected_byte_length >= 0),
  expected_sha256 char(64) CHECK (expected_sha256 IS NULL OR expected_sha256 ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (operation_id, workspace_id) REFERENCES operations(id, workspace_id),
  UNIQUE (operation_id)
);

CREATE INDEX relations_source_idx
  ON relations(workspace_id, dataset_id, source_kind, source_id)
  WHERE ended_at IS NULL;
CREATE INDEX relations_target_idx
  ON relations(workspace_id, dataset_id, target_kind, target_id)
  WHERE ended_at IS NULL;

ALTER TABLE application_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_registrations FORCE ROW LEVEL SECURITY;
ALTER TABLE policy_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE break_glass_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE break_glass_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE revision_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE revision_blobs FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_isolation_applications ON application_registrations
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_policy_assignments ON policy_assignments
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_break_glass ON break_glass_grants
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_upload_sessions ON upload_sessions
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_revision_blobs ON revision_blobs
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);

COMMIT;
