BEGIN;
ALTER TABLE outbox_events ADD COLUMN locked_by text;
ALTER TABLE outbox_events ADD COLUMN locked_until timestamptz;
ALTER TABLE outbox_events ADD COLUMN quarantined_at timestamptz;
ALTER TABLE outbox_events ADD COLUMN quarantine_reason text;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_outbox ON outbox_events USING (workspace_id=current_setting('trust.workspace_id',true)::uuid) WITH CHECK (workspace_id=current_setting('trust.workspace_id',true)::uuid);
CREATE INDEX outbox_claim_idx ON outbox_events(available_at,locked_until) WHERE processed_at IS NULL AND quarantined_at IS NULL;
CREATE TABLE reconciliation_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), operation_id uuid NOT NULL REFERENCES operations(id),
  severity text NOT NULL CHECK (severity IN ('warning','critical')), code text NOT NULL, message text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
ALTER TABLE reconciliation_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_incidents FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation_reconciliation ON reconciliation_incidents USING (workspace_id=current_setting('trust.workspace_id',true)::uuid) WITH CHECK (workspace_id=current_setting('trust.workspace_id',true)::uuid);
COMMIT;
