BEGIN;

ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_workspace_id_id_unique
  UNIQUE (workspace_id, id);

CREATE TABLE quarantine_scan_jobs (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  workspace_id uuid NOT NULL,
  upload_id uuid NOT NULL,
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
  UNIQUE (workspace_id, upload_id),
  FOREIGN KEY (workspace_id, upload_id)
    REFERENCES upload_sessions (workspace_id, id)
);

ALTER TABLE quarantine_scan_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarantine_scan_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_quarantine_scan_jobs ON quarantine_scan_jobs
  USING (workspace_id = current_setting('trust.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('trust.workspace_id', true)::uuid);

COMMIT;
