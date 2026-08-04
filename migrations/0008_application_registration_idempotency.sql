BEGIN;

ALTER TABLE application_registrations
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_fingerprint char(64),
  ADD CONSTRAINT application_registration_idempotency_pair
    CHECK (
      (idempotency_key IS NULL AND request_fingerprint IS NULL)
      OR (
        idempotency_key IS NOT NULL
        AND request_fingerprint IS NOT NULL
        AND length(trim(idempotency_key)) > 0
        AND request_fingerprint ~ '^[a-f0-9]{64}$'
      )
    );

CREATE UNIQUE INDEX application_registration_idempotency_idx
  ON application_registrations(workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
