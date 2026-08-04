BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schema_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace text NOT NULL,
  name text NOT NULL,
  semantic_version text NOT NULL,
  schema_digest char(64) NOT NULL CHECK (schema_digest ~ '^[a-f0-9]{64}$'),
  manifest_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (namespace, name, semantic_version)
);

CREATE TABLE datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  schema_package_id uuid NOT NULL REFERENCES schema_packages(id),
  dataset_type text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted_logically', 'legal_hold')),
  retention_policy_id uuid,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  dataset_id uuid NOT NULL REFERENCES datasets(id),
  resource_type text NOT NULL,
  title text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted_logically', 'legal_hold')),
  current_revision_id uuid,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id, dataset_id)
);

CREATE TABLE blob_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  media_type text NOT NULL,
  storage_provider text NOT NULL,
  storage_key text NOT NULL,
  encryption_key_ref text,
  encryption_state text NOT NULL DEFAULT 'provider_managed',
  verification_state text NOT NULL DEFAULT 'pending' CHECK (verification_state IN ('pending', 'verified', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, sha256),
  UNIQUE (storage_provider, storage_key),
  UNIQUE (id, workspace_id)
);

CREATE TABLE revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  dataset_id uuid NOT NULL REFERENCES datasets(id),
  resource_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  parent_revision_id uuid,
  merge_parent_revision_ids uuid[] NOT NULL DEFAULT '{}',
  schema_package_id uuid NOT NULL REFERENCES schema_packages(id),
  schema_version text NOT NULL,
  canonical_payload_json jsonb NOT NULL,
  canonical_payload_hash char(64) NOT NULL CHECK (canonical_payload_hash ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL,
  created_on_device_id uuid,
  source text NOT NULL CHECK (source IN ('user', 'application', 'import', 'restore', 'merge')),
  change_note text,
  restored_from_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (resource_id, workspace_id, dataset_id) REFERENCES resources(id, workspace_id, dataset_id),
  FOREIGN KEY (parent_revision_id) REFERENCES revisions(id),
  FOREIGN KEY (restored_from_revision_id) REFERENCES revisions(id),
  UNIQUE (resource_id, revision_number),
  UNIQUE (id, resource_id),
  UNIQUE (id, workspace_id)
);

ALTER TABLE resources
  ADD CONSTRAINT resources_current_revision_fk
  FOREIGN KEY (current_revision_id, id) REFERENCES revisions(id, resource_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE revision_blobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  revision_id uuid NOT NULL,
  blob_object_id uuid NOT NULL,
  role text NOT NULL,
  logical_name text,
  metadata_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (revision_id, workspace_id) REFERENCES revisions(id, workspace_id),
  FOREIGN KEY (blob_object_id, workspace_id) REFERENCES blob_objects(id, workspace_id),
  UNIQUE (revision_id, blob_object_id, role)
);

CREATE TABLE relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  dataset_id uuid NOT NULL REFERENCES datasets(id),
  source_kind text NOT NULL CHECK (source_kind IN ('resource', 'revision', 'blob', 'external')),
  source_id text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('resource', 'revision', 'blob', 'external')),
  target_id text NOT NULL,
  relation_type text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE TABLE tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  dataset_id uuid NOT NULL REFERENCES datasets(id),
  subject_kind text NOT NULL CHECK (subject_kind IN ('dataset', 'resource', 'relation')),
  subject_id text NOT NULL,
  deleted_by text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  recover_until timestamptz,
  prior_revision_id uuid REFERENCES revisions(id),
  purge_state text NOT NULL DEFAULT 'not_eligible' CHECK (purge_state IN ('not_eligible', 'eligible', 'planned', 'purged'))
);

CREATE TABLE operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  operation_type text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL,
  requested_by text NOT NULL,
  request_json jsonb NOT NULL,
  result_json jsonb,
  error_code text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (operation_type, workspace_id, idempotency_key)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  operation_id uuid NOT NULL REFERENCES operations(id),
  event_type text NOT NULL,
  payload_json jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  processed_at timestamptz,
  last_error text
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  dataset_id uuid REFERENCES datasets(id),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'service', 'system')),
  actor_id text NOT NULL,
  action text NOT NULL,
  subject_kind text NOT NULL,
  subject_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL,
  correlation_id text NOT NULL,
  operation_id uuid REFERENCES operations(id),
  previous_event_hash char(64),
  event_hash char(64) NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  metadata_json jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX revisions_resource_created_idx ON revisions(resource_id, created_at DESC);
CREATE INDEX audit_workspace_time_idx ON audit_events(workspace_id, occurred_at DESC);
CREATE INDEX operations_state_idx ON operations(state, updated_at);
CREATE INDEX outbox_pending_idx ON outbox_events(available_at) WHERE processed_at IS NULL;

ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasets FORCE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources FORCE ROW LEVEL SECURITY;
ALTER TABLE blob_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE blob_objects FORCE ROW LEVEL SECURITY;
ALTER TABLE revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE relations FORCE ROW LEVEL SECURITY;
ALTER TABLE tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE tombstones FORCE ROW LEVEL SECURITY;
ALTER TABLE operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_isolation_datasets ON datasets USING (workspace_id = current_setting('trust.workspace_id', true)::uuid) WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_resources ON resources USING (workspace_id = current_setting('trust.workspace_id', true)::uuid) WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_blobs ON blob_objects USING (workspace_id = current_setting('trust.workspace_id', true)::uuid) WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_revisions ON revisions USING (workspace_id = current_setting('trust.workspace_id', true)::uuid) WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_relations ON relations USING (workspace_id = current_setting('trust.workspace_id', true)::uuid) WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_tombstones ON tombstones USING (workspace_id = current_setting('trust.workspace_id', true)::uuid) WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_operations ON operations USING (workspace_id = current_setting('trust.workspace_id', true)::uuid) WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_audit ON audit_events USING (workspace_id = current_setting('trust.workspace_id', true)::uuid) WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);

COMMIT;
