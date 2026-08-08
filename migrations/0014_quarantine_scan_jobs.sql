BEGIN;

CREATE TABLE quarantine_scan_jobs (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  upload_id uuid NOT NULL REFERENCES upload_sessions(id),
  storage_key text NOT NULL CHECK (length(btrim(storage_key)) > 0),
  state text NOT NULL CHECK (state IN (
    'pending_upload',
    'uploaded',
    'scan_queued',
    'scanning',
    'accepted',
    'rejected',
    'manual_review',
    'promotion_pending',
    'promoted',
    'failed'
  )),
  outcome text CHECK (
    outcome IS NULL OR outcome IN (
      'clean',
      'malicious',
      'suspicious',
      'unsupported',
      'error',
      'timeout'
    )
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, upload_id)
);

CREATE INDEX quarantine_scan_jobs_upload_idx
  ON quarantine_scan_jobs(workspace_id, upload_id);

ALTER TABLE quarantine_scan_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarantine_scan_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_quarantine_scan_jobs ON quarantine_scan_jobs
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);

COMMIT;
