BEGIN;

CREATE TABLE retention_policies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  recovery_window_days integer NOT NULL CHECK (recovery_window_days BETWEEN 0 AND 36500),
  minimum_history_days integer NOT NULL CHECK (minimum_history_days BETWEEN 0 AND 36500),
  backup_retention_days integer NOT NULL CHECK (backup_retention_days BETWEEN 0 AND 36500),
  purge_enabled boolean NOT NULL DEFAULT false CHECK (purge_enabled = false),
  extensions_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(extensions_json) = 'object'),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, name)
);

ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_retention_policies ON retention_policies
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);

CREATE TABLE retention_policy_requests (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, actor_id, idempotency_key)
);
ALTER TABLE retention_policy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_policy_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_retention_policy_requests ON retention_policy_requests
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);

ALTER TABLE datasets
  ADD CONSTRAINT datasets_retention_policy_fk
  FOREIGN KEY (workspace_id, retention_policy_id)
  REFERENCES retention_policies(workspace_id, id)
  NOT VALID;

ALTER TABLE blob_objects
  ADD CONSTRAINT blob_objects_encryption_state_check
  CHECK (encryption_state IN ('provider_managed', 'customer_managed')),
  ADD CONSTRAINT blob_objects_encryption_key_ref_check
  CHECK (
    encryption_key_ref IS NULL OR
    (
      length(btrim(encryption_key_ref)) > 0 AND
      encryption_key_ref !~* '(secret|password|private[_-]?key)[[:space:]]*[:=]'
    )
  ),
  ADD CONSTRAINT blob_objects_customer_key_ref_check
  CHECK (encryption_state <> 'customer_managed' OR encryption_key_ref IS NOT NULL);

CREATE FUNCTION prevent_blob_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR
     NEW.workspace_id <> OLD.workspace_id OR
     NEW.sha256 <> OLD.sha256 OR
     NEW.byte_length <> OLD.byte_length OR
     NEW.media_type <> OLD.media_type OR
     NEW.storage_provider <> OLD.storage_provider OR
     NEW.storage_key <> OLD.storage_key OR
     NEW.encryption_state <> OLD.encryption_state OR
     NEW.encryption_key_ref IS DISTINCT FROM OLD.encryption_key_ref OR
     NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'canonical blob metadata is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER blob_objects_identity_immutable
BEFORE UPDATE ON blob_objects
FOR EACH ROW EXECUTE FUNCTION prevent_blob_identity_mutation();

COMMIT;
