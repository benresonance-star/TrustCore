BEGIN;

ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_actor_type_check,
  ADD CONSTRAINT audit_events_actor_type_check
    CHECK (actor_type IN ('user', 'service', 'application', 'system'));

COMMIT;
