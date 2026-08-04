BEGIN;
CREATE TABLE verification_runs (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
  verification_level text NOT NULL CHECK (verification_level IN ('metadata','full_blob','resource','dataset','workspace')),
  status text NOT NULL CHECK (status IN ('running','passed','failed','degraded')),
  started_at timestamptz NOT NULL, completed_at timestamptz,
  objects_checked integer NOT NULL DEFAULT 0 CHECK (objects_checked>=0),
  bytes_read bigint NOT NULL DEFAULT 0 CHECK (bytes_read>=0), issues_json jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX verification_workspace_time_idx ON verification_runs(workspace_id,started_at DESC);
ALTER TABLE verification_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_verification ON verification_runs USING (workspace_id=current_setting('trust.workspace_id',true)::uuid) WITH CHECK (workspace_id=current_setting('trust.workspace_id',true)::uuid);
COMMIT;
