BEGIN;

ALTER TABLE revisions
  ALTER CONSTRAINT revisions_parent_revision_id_fkey
    DEFERRABLE INITIALLY DEFERRED,
  ALTER CONSTRAINT revisions_restored_from_revision_id_fkey
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE portability_exports (
  id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  dataset_ids uuid[] NOT NULL CHECK (cardinality(dataset_ids) > 0),
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  signature_profile text NOT NULL CHECK (signature_profile IN ('unsigned')),
  archive_sha256 char(64) CHECK (archive_sha256 IS NULL OR archive_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint CHECK (byte_length IS NULL OR byte_length >= 0),
  storage_provider text,
  storage_key text,
  requested_by text NOT NULL CHECK (btrim(requested_by) <> ''),
  requested_by_principal_type text NOT NULL CHECK (requested_by_principal_type IN ('user', 'service', 'application')),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  manifest_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, requested_by_principal_type, requested_by, idempotency_key),
  CHECK ((status = 'ready') = (archive_sha256 IS NOT NULL AND byte_length IS NOT NULL AND storage_provider IS NOT NULL AND storage_key IS NOT NULL AND manifest_json IS NOT NULL)),
  CHECK ((storage_provider IS NULL) = (storage_key IS NULL))
);

CREATE TABLE portability_archives (
  id char(64) NOT NULL CHECK (id ~ '^[a-f0-9]{64}$'),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  source_export_id text NOT NULL CHECK (btrim(source_export_id) <> ''),
  source_workspace_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('verified', 'rejected')),
  signature_profile text NOT NULL CHECK (signature_profile IN ('unsigned')),
  checked_entries integer NOT NULL CHECK (checked_entries >= 0),
  issue_count integer NOT NULL CHECK (issue_count >= 0),
  archive_sha256 char(64) NOT NULL CHECK (archive_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  storage_provider text NOT NULL CHECK (btrim(storage_provider) <> ''),
  storage_key text NOT NULL CHECK (btrim(storage_key) <> ''),
  manifest_json jsonb NOT NULL,
  verification_json jsonb NOT NULL,
  uploaded_by text NOT NULL CHECK (btrim(uploaded_by) <> ''),
  uploaded_by_principal_type text NOT NULL CHECK (uploaded_by_principal_type IN ('user', 'service', 'application')),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, uploaded_by_principal_type, uploaded_by, idempotency_key),
  UNIQUE (storage_provider, storage_key),
  CHECK (id = archive_sha256)
);

CREATE TABLE portability_plans (
  id char(64) NOT NULL CHECK (id ~ '^[a-f0-9]{64}$'),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  archive_id char(64) NOT NULL,
  source_workspace_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('preserve_ids', 'mapped_workspace')),
  conflict_mode text NOT NULL CHECK (conflict_mode IN ('reject_on_error', 'report_only')),
  status text NOT NULL CHECK (status IN ('ready', 'rejected', 'report_only')),
  plan_json jsonb NOT NULL,
  requested_by text NOT NULL CHECK (btrim(requested_by) <> ''),
  requested_by_principal_type text NOT NULL CHECK (requested_by_principal_type IN ('user', 'service', 'application')),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, requested_by_principal_type, requested_by, idempotency_key),
  FOREIGN KEY (workspace_id, archive_id) REFERENCES portability_archives(workspace_id, id)
);

CREATE TABLE portability_import_operations (
  id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  plan_id char(64) NOT NULL,
  archive_export_id text NOT NULL CHECK (btrim(archive_export_id) <> ''),
  requested_by text NOT NULL CHECK (btrim(requested_by) <> ''),
  requested_by_principal_type text NOT NULL CHECK (requested_by_principal_type IN ('user', 'service', 'application')),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  checkpoint text NOT NULL CHECK (checkpoint IN ('authorised', 'target_revalidated', 'temporary_blobs_staged', 'staged_blobs_verified', 'immutable_blobs_committed', 'metadata_committed', 'audit_committed', 'completed')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, plan_id),
  UNIQUE (workspace_id, requested_by_principal_type, requested_by, idempotency_key),
  FOREIGN KEY (workspace_id, plan_id) REFERENCES portability_plans(workspace_id, id),
  CHECK ((checkpoint = 'completed') = (completed_at IS NOT NULL))
);

CREATE TABLE imported_archive_audit_events (
  id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  import_operation_id uuid NOT NULL,
  source_workspace_id uuid NOT NULL,
  source_event_id text NOT NULL CHECK (btrim(source_event_id) <> ''),
  source_previous_event_hash char(64),
  source_event_hash char(64) NOT NULL CHECK (source_event_hash ~ '^[a-f0-9]{64}$'),
  source_event_json jsonb NOT NULL,
  imported_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, import_operation_id, source_event_id),
  FOREIGN KEY (workspace_id, import_operation_id) REFERENCES portability_import_operations(workspace_id, id),
  CHECK (source_previous_event_hash IS NULL OR source_previous_event_hash ~ '^[a-f0-9]{64}$')
);

CREATE FUNCTION enforce_portability_export_datasets() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF cardinality(NEW.dataset_ids) <> (
    SELECT count(DISTINCT dataset_id)
    FROM unnest(NEW.dataset_ids) AS selected(dataset_id)
  ) THEN
    RAISE EXCEPTION 'portability export dataset IDs must be unique'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.dataset_ids) AS selected(dataset_id)
    LEFT JOIN datasets
      ON datasets.id = selected.dataset_id
     AND datasets.workspace_id = NEW.workspace_id
    WHERE datasets.id IS NULL
  ) THEN
    RAISE EXCEPTION 'portability export dataset is missing or belongs to another workspace'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER portability_exports_datasets_guard
BEFORE INSERT OR UPDATE OF workspace_id, dataset_ids ON portability_exports
FOR EACH ROW EXECUTE FUNCTION enforce_portability_export_datasets();

CREATE INDEX portability_exports_workspace_created_idx ON portability_exports(workspace_id, created_at DESC);
CREATE INDEX portability_archives_workspace_created_idx ON portability_archives(workspace_id, created_at DESC);
CREATE INDEX portability_plans_workspace_created_idx ON portability_plans(workspace_id, created_at DESC);
CREATE INDEX portability_import_operations_workspace_updated_idx ON portability_import_operations(workspace_id, updated_at DESC);
CREATE INDEX imported_archive_audit_events_source_idx ON imported_archive_audit_events(workspace_id, source_workspace_id, imported_at, id);

ALTER TABLE portability_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE portability_exports FORCE ROW LEVEL SECURITY;
ALTER TABLE portability_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE portability_archives FORCE ROW LEVEL SECURITY;
ALTER TABLE portability_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE portability_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE portability_import_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE portability_import_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE imported_archive_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE imported_archive_audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_isolation_portability_exports ON portability_exports
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_portability_archives ON portability_archives
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_portability_plans ON portability_plans
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_portability_import_operations ON portability_import_operations
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);
CREATE POLICY workspace_isolation_imported_archive_audit_events ON imported_archive_audit_events
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);

COMMIT;
