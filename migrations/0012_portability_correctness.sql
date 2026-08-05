BEGIN;

ALTER TABLE portability_archives
  DROP CONSTRAINT portability_archives_pkey,
  DROP CONSTRAINT portability_archives_storage_provider_storage_key_key,
  ADD PRIMARY KEY (workspace_id, id),
  ADD UNIQUE (workspace_id, storage_provider, storage_key);

ALTER TABLE tombstones
  ADD COLUMN restored_by text;

COMMIT;
