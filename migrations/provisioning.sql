-- Local/development role provisioning. Production deployment tooling should
-- create equivalent login roles with secrets from its secret manager.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trust_application') THEN
    CREATE ROLE trust_application NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trust_outbox_worker') THEN
    CREATE ROLE trust_outbox_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trust_verification') THEN
    CREATE ROLE trust_verification NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trust_audit_reader') THEN
    CREATE ROLE trust_audit_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trust_audit_writer') THEN
    CREATE ROLE trust_audit_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trust_backup_restore') THEN
    CREATE ROLE trust_backup_restore NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trust_app_local') THEN
    CREATE ROLE trust_app_local LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trust_worker_local') THEN
    CREATE ROLE trust_worker_local LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trust_verifier_local') THEN
    CREATE ROLE trust_verifier_local LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trust_audit_reader_local') THEN
    CREATE ROLE trust_audit_reader_local LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trust_audit_writer_local') THEN
    CREATE ROLE trust_audit_writer_local LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trust_backup_local') THEN
    CREATE ROLE trust_backup_local LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format(
    'ALTER ROLE trust_app_local PASSWORD %L',
    coalesce(nullif(current_setting('trust.provision_app_password', true), ''), 'trust_app_local_only')
  );
  EXECUTE format(
    'ALTER ROLE trust_worker_local PASSWORD %L',
    coalesce(nullif(current_setting('trust.provision_worker_password', true), ''), 'trust_worker_local_only')
  );
  EXECUTE format(
    'ALTER ROLE trust_verifier_local PASSWORD %L',
    coalesce(nullif(current_setting('trust.provision_verifier_password', true), ''), 'trust_verifier_local_only')
  );
  EXECUTE format(
    'ALTER ROLE trust_audit_reader_local PASSWORD %L',
    coalesce(nullif(current_setting('trust.provision_audit_reader_password', true), ''), 'trust_audit_reader_local_only')
  );
  EXECUTE format(
    'ALTER ROLE trust_audit_writer_local PASSWORD %L',
    coalesce(nullif(current_setting('trust.provision_audit_writer_password', true), ''), 'trust_audit_writer_local_only')
  );
  EXECUTE format(
    'ALTER ROLE trust_backup_local PASSWORD %L',
    coalesce(nullif(current_setting('trust.provision_backup_password', true), ''), 'trust_backup_local_only')
  );
END
$$;
GRANT trust_application TO trust_app_local;
GRANT trust_outbox_worker TO trust_worker_local;
GRANT trust_verification TO trust_verifier_local;
GRANT trust_audit_reader TO trust_audit_reader_local;
GRANT trust_audit_writer TO trust_audit_writer_local;
GRANT trust_backup_restore TO trust_backup_local;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON trust_schema_migrations FROM
  trust_application,
  trust_outbox_worker,
  trust_verification,
  trust_audit_reader,
  trust_audit_writer;

DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO trust_application, trust_outbox_worker, trust_verification, trust_audit_reader, trust_audit_writer, trust_backup_restore',
    current_database()
  );
END
$$;
GRANT USAGE ON SCHEMA public TO
  trust_application,
  trust_outbox_worker,
  trust_verification,
  trust_audit_reader,
  trust_audit_writer,
  trust_backup_restore;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO trust_application;

GRANT SELECT, INSERT, UPDATE ON
  workspaces,
  schema_packages,
  datasets,
  resources,
  blob_objects,
  revisions,
  revision_blobs,
  relations,
  tombstones,
  operations,
  outbox_events,
  audit_events,
  verification_runs,
  reconciliation_incidents,
  application_registrations,
  upload_sessions
TO trust_application;
REVOKE INSERT, UPDATE, DELETE ON
  policy_assignments,
  break_glass_grants
FROM trust_application;
GRANT SELECT ON
  policy_assignments,
  break_glass_grants
TO trust_application;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  identity_login_transactions,
  identity_sessions
TO trust_application;

GRANT SELECT, UPDATE ON outbox_events TO trust_outbox_worker;
GRANT SELECT ON blob_objects TO trust_outbox_worker;
GRANT SELECT, INSERT ON reconciliation_incidents TO trust_outbox_worker;

GRANT SELECT ON
  workspaces,
  application_registrations,
  policy_assignments,
  break_glass_grants,
  datasets,
  resources,
  revisions,
  revision_blobs,
  blob_objects,
  relations,
  tombstones,
  operations,
  upload_sessions,
  audit_events
TO trust_verification;
GRANT SELECT, INSERT, UPDATE ON verification_runs TO trust_verification;

GRANT SELECT ON audit_events TO trust_audit_reader;
GRANT SELECT, INSERT ON audit_events TO trust_audit_writer;

GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO trust_backup_restore;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO trust_backup_restore;

ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS worker_outbox_access ON outbox_events;
CREATE POLICY worker_outbox_access ON outbox_events
  TO trust_outbox_worker
  USING (true)
  WITH CHECK (true);
