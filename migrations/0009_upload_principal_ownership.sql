BEGIN;

ALTER TABLE operations
  ADD COLUMN requested_by_principal_type text NOT NULL DEFAULT 'user'
    CHECK (requested_by_principal_type IN ('user', 'service', 'application')),
  ADD COLUMN idempotency_scope text NOT NULL DEFAULT '';

ALTER TABLE operations
  DROP CONSTRAINT operations_operation_type_workspace_id_idempotency_key_key;

ALTER TABLE operations
  ADD CONSTRAINT operations_idempotency_scope_unique
  UNIQUE (operation_type, workspace_id, idempotency_key, idempotency_scope),
  ADD CONSTRAINT operations_idempotency_scope_matches_owner CHECK (
    (
      operation_type = 'upload.session'
      AND idempotency_scope = requested_by_principal_type || ':' || requested_by
    )
    OR (operation_type <> 'upload.session' AND idempotency_scope = '')
  );

CREATE FUNCTION prevent_upload_operation_owner_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.operation_type = 'upload.session' AND (
    NEW.operation_type IS DISTINCT FROM OLD.operation_type
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.requested_by_principal_type IS DISTINCT FROM OLD.requested_by_principal_type
    OR NEW.idempotency_scope IS DISTINCT FROM OLD.idempotency_scope
  ) THEN
    RAISE EXCEPTION 'upload operation ownership is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER operations_upload_owner_immutable
BEFORE UPDATE ON operations
FOR EACH ROW EXECUTE FUNCTION prevent_upload_operation_owner_change();

DROP POLICY workspace_isolation_operations ON operations;
CREATE POLICY workspace_isolation_operations ON operations
  USING (
    workspace_id = current_setting('trust.workspace_id', true)::uuid
    AND (
      coalesce(nullif(current_setting('trust.principal_type', true), ''), 'user') <> 'application'
      OR operation_type <> 'upload.session'
      OR (
        requested_by_principal_type = 'application'
        AND requested_by = current_setting('trust.principal_id', true)
      )
    )
  )
  WITH CHECK (
    workspace_id = current_setting('trust.workspace_id', true)::uuid
    AND (
      coalesce(nullif(current_setting('trust.principal_type', true), ''), 'user') <> 'application'
      OR operation_type <> 'upload.session'
      OR (
        requested_by_principal_type = 'application'
        AND requested_by = current_setting('trust.principal_id', true)
      )
    )
  );

DROP POLICY workspace_isolation_upload_sessions ON upload_sessions;
CREATE POLICY workspace_isolation_upload_sessions ON upload_sessions
  USING (
    workspace_id = current_setting('trust.workspace_id', true)::uuid
    AND (
      coalesce(nullif(current_setting('trust.principal_type', true), ''), 'user') <> 'application'
      OR EXISTS (
        SELECT 1
        FROM operations
        WHERE operations.id = upload_sessions.operation_id
          AND operations.workspace_id = upload_sessions.workspace_id
          AND operations.requested_by_principal_type = 'application'
          AND operations.requested_by = current_setting('trust.principal_id', true)
      )
    )
  )
  WITH CHECK (
    workspace_id = current_setting('trust.workspace_id', true)::uuid
    AND (
      coalesce(nullif(current_setting('trust.principal_type', true), ''), 'user') <> 'application'
      OR EXISTS (
        SELECT 1
        FROM operations
        WHERE operations.id = upload_sessions.operation_id
          AND operations.workspace_id = upload_sessions.workspace_id
          AND operations.requested_by_principal_type = 'application'
          AND operations.requested_by = current_setting('trust.principal_id', true)
      )
    )
  );

COMMIT;
